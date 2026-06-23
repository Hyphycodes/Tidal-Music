-- 0002_core_tables.sql — entity tables (PROJECT_CONTEXT §5)
-- Conventions:
--   * uuid PKs via gen_random_uuid(); join tables use composite PKs
--   * created_at / updated_at on every entity table
--   * name columns are citext → case-insensitive upsert-by-name (ON CONFLICT (name))
--   * FKs: ON DELETE SET NULL for optional links, ON DELETE CASCADE for child rows
-- Additions beyond §5 (documented in supabase/README.md):
--   * tracks.album_title  — denormalized hot field (speed doctrine §9), like artist_name
--   * playlists / playlist_tracks — Tidal "presented self" membership (§02 option)

-- ── artists ──────────────────────────────────────────────────────────────
create table if not exists artists (
  id             uuid primary key default gen_random_uuid(),
  mbid           text,
  name           citext not null unique,
  origin_city    text,
  origin_country text,
  began_year     int,
  scene          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── labels ───────────────────────────────────────────────────────────────
create table if not exists labels (
  id         uuid primary key default gen_random_uuid(),
  name       citext not null unique,
  country    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── releases (canonical; created by the MusicBrainz worker, keyed on mbid) ──
create table if not exists releases (
  id         uuid primary key default gen_random_uuid(),
  mbid       text,
  title      text,
  label_id   uuid references labels(id) on delete set null,
  country    text,
  year       int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── people (producers, engineers, players — from Discogs) ──────────────────
create table if not exists people (
  id         uuid primary key default gen_random_uuid(),
  mbid       text,
  name       citext not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── tracks (the heart) ─────────────────────────────────────────────────────
-- isrc = cross-source join key (unique when present); tidal_id = source identity.
create table if not exists tracks (
  id                uuid primary key default gen_random_uuid(),
  isrc              text,
  mbid              text,
  tidal_id          text not null unique,
  title             text not null,
  artist_name       text not null,        -- denormalized hot field (no join to render a row)
  album_title       text,                 -- denormalized hot field (see README)
  primary_artist_id uuid references artists(id)  on delete set null,
  album_id          uuid references releases(id) on delete set null,
  duration_sec      int,
  release_date      date,
  saved_at          timestamptz,
  genre             text,
  bpm               numeric,
  musical_key       text,
  energy            int check (energy between 1 and 10),
  mood              text[],
  enrichment_status text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── track_artists (all artists on a track, incl. features) ─────────────────
create table if not exists track_artists (
  track_id  uuid not null references tracks(id)  on delete cascade,
  artist_id uuid not null references artists(id) on delete cascade,
  role      text not null default 'main',
  primary key (track_id, artist_id, role)
);

-- ── credits (personnel per track — from Discogs) ───────────────────────────
create table if not exists credits (
  id         uuid primary key default gen_random_uuid(),
  track_id   uuid not null references tracks(id)  on delete cascade,
  person_id  uuid not null references people(id)  on delete cascade,
  role       text not null,                -- controlled: producer|engineer|writer|featuring|performer
  source     text,                         -- usually 'discogs'
  confidence numeric,                      -- reflects match score
  created_at timestamptz not null default now(),
  unique (track_id, person_id, role)
);

-- ── relationships (derived artist graph) ───────────────────────────────────
-- Normalized so a–b == b–a: always store with artist_a < artist_b.
create table if not exists relationships (
  id         uuid primary key default gen_random_uuid(),
  artist_a   uuid not null references artists(id) on delete cascade,
  artist_b   uuid not null references artists(id) on delete cascade,
  kind       text not null,                -- shared_producer | same_label | same_scene | same_session
  weight     numeric not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_a, artist_b, kind),
  check (artist_a < artist_b)
);

-- ── playlists / playlist_tracks (Tidal "presented self") ───────────────────
create table if not exists playlists (
  id         uuid primary key default gen_random_uuid(),
  tidal_id   text not null unique,
  title      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists playlist_tracks (
  playlist_id uuid not null references playlists(id) on delete cascade,
  track_id    uuid not null references tracks(id)    on delete cascade,
  primary key (playlist_id, track_id)
);
