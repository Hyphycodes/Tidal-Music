# Supabase — schema & migrations

The complete Postgres schema for **Crate**, as ordered SQL migrations. Apply them
in numeric order against a fresh database; every file is idempotent (`if not
exists` / `create or replace` / guarded `do` blocks), so re-applying is safe.

## Files

| Order | File | Contents |
|------|------|----------|
| 0001 | `migrations/0001_extensions.sql` | `pgcrypto`, `citext`, `vector` |
| 0002 | `migrations/0002_core_tables.sql` | entity tables (§5) + playlists |
| 0003 | `migrations/0003_enrichment_and_meta.sql` | `enrichment_jobs`, `tags`, `narratives`, `observations`, `track_embeddings`, `reset_stale_jobs()` |
| 0004 | `migrations/0004_lists.sql` | `lists`, `list_items` |
| 0005 | `migrations/0005_indexes.sql` | all performance indexes (speed doctrine) |
| 0006 | `migrations/0006_materialized_views.sql` | stat MVs, `v_orphans`, `refresh_stats()` |
| 0007 | `migrations/0007_readonly_role.sql` | `crate_readonly` role for `/api/query` |

## Apply

Using `psql` and the **session** connection string (Settings → Database →
Connection string → URI, port 5432 — *not* the pooler, for DDL):

```bash
export SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.YOUR_REF.supabase.co:5432/postgres"
for f in supabase/migrations/0*.sql; do
  echo ">>> $f"; psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

Or with the **Supabase CLI**: `supabase db push` (after `supabase link`).
Or paste each file into the **SQL Editor** in the dashboard, in order.

## The read-only role (one extra manual step)

`0007` creates `crate_readonly` as a NOLOGIN group with `SELECT`-only grants — no
password is stored in source control. To let `/api/query` connect as it, run once
with a secret of your choosing:

```sql
alter role crate_readonly with login password 'PICK_A_STRONG_PASSWORD';
```

Then set `SUPABASE_DB_URL_READONLY` (use the **pooler**, port 6543):

```
postgresql://crate_readonly:PICK_A_STRONG_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
```

### Prove it is read-only

```bash
# must FAIL with "permission denied for table labels"
psql "$SUPABASE_DB_URL_READONLY" -c "insert into labels(name) values ('x');"
# must SUCCEED
psql "$SUPABASE_DB_URL" -c "select refresh_stats();"
```

## Refresh stats

`refresh_stats()` refreshes every materialized view with `CONCURRENTLY` (each MV
has a unique index, and all MVs are created `WITH DATA` so they are already
"populated" — `CONCURRENTLY` works even on an empty database). The pipeline calls
it once at the end of every run.

```bash
psql "$SUPABASE_DB_URL" -c "select refresh_stats();"
```

## EXPLAIN — confirm index usage on the hot paths

Run these after applying (and ideally after some data exists). They are written
to hit the indexes in `0005`; expected plan shape noted beside each.

```sql
-- Library keyset fetch (idx_tracks_saved_keyset → Index Scan, no Seq Scan)
explain analyze
  select id, title, artist_name, album_title, genre, energy, bpm, musical_key,
         saved_at, release_date, duration_sec
    from tracks
   where (saved_at, id) < (now(), '00000000-0000-0000-0000-000000000000'::uuid)
   order by saved_at desc, id desc
   limit 50;
-- → Limit → Index Scan Backward using idx_tracks_saved_keyset on tracks

-- Orphans (idx_list_items_track supports the NOT EXISTS anti-join)
explain analyze select * from v_orphans order by saved_at desc limit 50;
-- → anti-join using idx_list_items_track; Index Scan on idx_tracks_saved_at

-- Stats MV read (trivial — full scan of a tiny MV, no request-time GROUP BY)
explain analyze select * from mv_label_counts order by track_count desc limit 25;
-- → Sort → Seq Scan on mv_label_counts (MV is small; this is intended)

-- Track detail join (PK + idx_credits_track + idx_tags_entity)
explain analyze select * from tracks where id = (select id from tracks limit 1);
-- → Index Scan using tracks_pkey
```

> These plans require a provisioned database to capture live output. The queries
> above are authored against the indexes in `0005`; paste the live `EXPLAIN
> ANALYZE` output here after your first apply to lock in verification.

## Notes / deviations from PROJECT_CONTEXT §5

Three additions, all justified by the speed doctrine or by an explicit option in
the prompts:

1. **`tracks.album_title`** — a denormalized hot field (like `tracks.artist_name`).
   The library row renders album title with **zero joins** (speed doctrine §9), and
   ingest can populate it immediately, before MusicBrainz resolves the canonical
   `releases` row. `tracks.album_id → releases` still carries the canonical
   label/country/year for the Detail screen.
2. **`playlists` / `playlist_tracks`** — `02_tidal_ingest.md` explicitly allows a
   `playlists`/`playlist_tracks` pair (vs. storing playlist names as tags). The
   dedicated tables model the Tidal "presented self" cleanly and power the
   *uncurated vs presented* stat and orphan reasoning.
3. **`mv_playlist_presence`** — precomputes the *in any playlist vs not* split so
   `/api/stats` never runs a request-time aggregate (speed doctrine §3.2).

Other design decisions:

- **Names are `citext`** (artists, labels, people) so upsert-by-name is
  case-insensitive via `ON CONFLICT (name)` — simpler and faster than a
  `lower(name)` expression index for `ON CONFLICT` inference.
- **`releases` and `tracks.album_id`/`primary_artist_id` are filled by the
  MusicBrainz worker**, not ingest. Ingest creates `artists` (by name) for
  `track_artists`/`primary_artist_id` and sets the denormalized `artist_name` /
  `album_title`; canonical releases/labels (which need `mbid`) arrive during
  enrichment. This keeps the data duplicate-free under the enrich-once model.
- **`credits`, `tags`** carry `source` + `confidence` so the fact/inference line
  is encoded in the data, not just the UI.
