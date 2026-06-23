# Web — performance notes

The read path is **local Postgres only** (speed doctrine §3.1): no endpoint here
makes an external HTTP or Claude call except `/api/query` (the explicit chat
surface). All GETs set `Cache-Control: public, s-maxage=300,
stale-while-revalidate=86400` — the data changes once daily after the nightly
sync, so the edge serves repeats instantly.

## Stack deviation (flagged)

PROJECT_CONTEXT §4 names `@supabase/supabase-js`. We use **`postgres`
(porsager)** instead, server-side only, because the core surfaces need raw
parameterized SQL that PostgREST can't express: keyset tuple pagination,
arbitrary generated `SELECT`s for `/api/query`, materialized-view reads, and a
dedicated **read-only role** connection. The client connects through the Supabase
**transaction pooler** (port 6543) with `prepare: false` (required for
pgBouncer). The connection string is server-only and never shipped to the client.

## Budgets (stated on the routes)

| Endpoint | Budget | Backed by |
|----------|--------|-----------|
| `/api/library` (warm first page) | < 400ms | `idx_tracks_saved_keyset` |
| `/api/track/[id]` | < 300ms | PK + `idx_credits_track` + `idx_tags_entity` |
| `/api/stats` | < 200ms | materialized views only |
| `/api/recommendations` | k-capped | HNSW `idx_track_embeddings_hnsw` |

## EXPLAIN — verify index usage

Run against the provisioned DB (paste output here after first deploy):

```sql
explain analyze
  select id, title, artist_name, album_title, genre, energy, bpm, musical_key,
         saved_at, release_date, duration_sec
    from tracks
   where (saved_at < now() or (saved_at = now() and id < gen_random_uuid()))
   order by saved_at desc, id desc limit 50;
-- expect: Index Scan using idx_tracks_saved_keyset (no Seq Scan)

explain analyze
  select * from track_embeddings order by embedding <=> (select embedding from track_embeddings limit 1) limit 8;
-- expect: Index Scan using idx_track_embeddings_hnsw
```

Notes:
- Secondary sorts (`energy`, `release_date`) coalesce the null sort key for a
  total keyset order; this trades the index scan for correctness on those less-hot
  sorts. The default `saved_at` sort keysets directly on the index.
- `/api/query` runs each generated statement inside a transaction with
  `SET LOCAL statement_timeout = 5000` so a pathological query can't hang.
