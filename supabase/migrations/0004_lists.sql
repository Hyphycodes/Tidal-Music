-- 0004_lists.sql — the personal curation layer (the one place the app writes)

create table if not exists lists (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  kind       text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists list_items (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references lists(id)   on delete cascade,
  track_id   uuid not null references tracks(id)  on delete cascade,
  rank       int,
  note       text,
  rating     int check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (list_id, track_id)               -- a track appears at most once per list
);
