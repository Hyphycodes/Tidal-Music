-- 0006_materialized_views.sql — precomputed stats (speed doctrine §3.2)
-- Created WITH DATA (default) so they are "populated" even on an empty DB,
-- which lets refresh_stats() use CONCURRENTLY immediately. Each MV has a UNIQUE
-- index (required for REFRESH ... CONCURRENTLY).

-- top artists by saved tracks
create materialized view if not exists mv_artist_counts as
  select a.id as artist_id, a.name::text as name, count(t.id) as track_count
    from artists a
    join tracks  t on t.primary_artist_id = a.id
   group by a.id, a.name;
create unique index if not exists uq_mv_artist_counts on mv_artist_counts (artist_id);

-- top producers (role ~ producer) by distinct tracks
create materialized view if not exists mv_producer_counts as
  select p.id as person_id, p.name::text as name, count(distinct c.track_id) as track_count
    from people  p
    join credits c on c.person_id = p.id
   where c.role = 'producer'
   group by p.id, p.name;
create unique index if not exists uq_mv_producer_counts on mv_producer_counts (person_id);

-- top labels by distinct tracks
create materialized view if not exists mv_label_counts as
  select l.id as label_id, l.name::text as name, count(distinct t.id) as track_count
    from labels   l
    join releases r on r.label_id = l.id
    join tracks   t on t.album_id = r.id
   group by l.id, l.name;
create unique index if not exists uq_mv_label_counts on mv_label_counts (label_id);

-- genre distribution
create materialized view if not exists mv_genre_distribution as
  select genre, count(*) as track_count
    from tracks
   where genre is not null and genre <> ''
   group by genre;
create unique index if not exists uq_mv_genre_distribution on mv_genre_distribution (genre);

-- decade distribution (from release_date)
create materialized view if not exists mv_decade_distribution as
  select ((extract(year from release_date)::int / 10) * 10) as decade, count(*) as track_count
    from tracks
   where release_date is not null
   group by 1;
create unique index if not exists uq_mv_decade_distribution on mv_decade_distribution (decade);

-- country distribution (from primary artist origin)
create materialized view if not exists mv_country_distribution as
  select a.origin_country as country, count(distinct t.id) as track_count
    from tracks  t
    join artists a on a.id = t.primary_artist_id
   where a.origin_country is not null and a.origin_country <> ''
   group by a.origin_country;
create unique index if not exists uq_mv_country_distribution on mv_country_distribution (country);

-- save-by-month timeline
create materialized view if not exists mv_save_timeline as
  select date_trunc('month', saved_at)::date as month, count(*) as track_count
    from tracks
   where saved_at is not null
   group by 1;
create unique index if not exists uq_mv_save_timeline on mv_save_timeline (month);

-- uncurated vs presented self: in ≥1 Tidal playlist vs not
create materialized view if not exists mv_playlist_presence as
  select (exists (select 1 from playlist_tracks pt where pt.track_id = t.id)) as in_playlist,
         count(*) as track_count
    from tracks t
   group by 1;
create unique index if not exists uq_mv_playlist_presence on mv_playlist_presence (in_playlist);

-- ── v_orphans: saved tracks in no personal list (library-row columns) ──────
create or replace view v_orphans as
  select t.id, t.title, t.artist_name, t.album_title, t.genre, t.energy,
         t.bpm, t.musical_key, t.saved_at, t.release_date, t.duration_sec
    from tracks t
   where not exists (select 1 from list_items li where li.track_id = t.id);

-- ── refresh_stats(): refresh every MV concurrently (called at end of pipeline)
-- NOTE: REFRESH MATERIALIZED VIEW CONCURRENTLY is transactional and is allowed
-- inside a function (unlike CREATE INDEX CONCURRENTLY / VACUUM).
create or replace function refresh_stats()
returns void
language plpgsql
as $$
begin
  refresh materialized view concurrently mv_artist_counts;
  refresh materialized view concurrently mv_producer_counts;
  refresh materialized view concurrently mv_label_counts;
  refresh materialized view concurrently mv_genre_distribution;
  refresh materialized view concurrently mv_decade_distribution;
  refresh materialized view concurrently mv_country_distribution;
  refresh materialized view concurrently mv_save_timeline;
  refresh materialized view concurrently mv_playlist_presence;
end;
$$;
