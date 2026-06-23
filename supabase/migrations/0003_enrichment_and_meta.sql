-- 0003_enrichment_and_meta.sql — enrichment jobs, tags, narratives, observations, embeddings

-- ── enrichment_jobs (the enrich-once engine; one row per (track, source)) ──
create table if not exists enrichment_jobs (
  id         uuid primary key default gen_random_uuid(),
  track_id   uuid not null references tracks(id) on delete cascade,
  source     text not null,                 -- musicbrainz | discogs | claude | liner_notes
  status     text not null default 'pending', -- pending | running | done | failed | skipped
  attempts   int  not null default 0,
  last_error text,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (track_id, source)
);

-- ── tags (facts + inferences live together; source + confidence distinguish) ─
create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,                -- track | artist | release | label | person
  entity_id   uuid not null,
  tag         text not null,                -- dimension: scene | era | genre | playlist | sample | ...
  value       text,                         -- content: 'Lagos Afrobeats', '2010s', ...
  source      text not null,                -- musicbrainz | discogs | claude | tidal | local
  confidence  numeric,                      -- 0..1 (1.0 = verified fact)
  created_at  timestamptz not null default now()
);
-- coalesce(value,'') so NULL values still participate in uniqueness (idempotent upsert)
create unique index if not exists tags_uq
  on tags (entity_type, entity_id, tag, coalesce(value, ''), source);

-- ── narratives (Claude liner notes — one row per entity) ───────────────────
create table if not exists narratives (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,                -- artist | release
  entity_id   uuid not null,
  body        text not null,
  source      text not null default 'claude',
  model       text,
  created_at  timestamptz not null default now(),
  unique (entity_type, entity_id)
);

-- ── track_embeddings (similarity / adjacency) ──────────────────────────────
create table if not exists track_embeddings (
  track_id   uuid primary key references tracks(id) on delete cascade,
  embedding  vector(1024),
  model      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── observations (exactly one daily insight per pipeline run) ──────────────
create table if not exists observations (
  id         uuid primary key default gen_random_uuid(),
  body       text not null,
  kind       text not null,
  payload    jsonb,
  shown      boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── reset_stale_jobs(p_minutes): recover orphaned 'running' jobs ───────────
create or replace function reset_stale_jobs(p_minutes int default 15)
returns int
language sql
as $$
  with updated as (
    update enrichment_jobs
       set status = 'pending', updated_at = now()
     where status = 'running'
       and updated_at < now() - make_interval(mins => p_minutes)
    returning 1
  )
  select count(*)::int from updated;
$$;
