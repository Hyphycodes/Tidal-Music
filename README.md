# Crate

A single-user web app that turns my **Tidal saved library** into an owned,
enriched, queryable database of my musical taste.

1. **Mirrors** Tidal favorites + playlists into my own Postgres.
2. **Enriches** every track once — labels, countries, credits, scene/era,
   energy/mood, and a written liner note — via MusicBrainz, Discogs, and one
   Claude pass per track.
3. **Lets me read & dig**: browsable library, Atlas stats, the artist Web,
   orphan tracks, and one fresh daily observation.
4. **Lets me talk to it** in plain English — it queries my real data and answers.

Two phases that never mix: **enrichment** is slow + background (rate-limited
external calls, runs locally + nightly via GitHub Actions); **browsing** is
instant and only ever reads local Postgres.

## Layout

```
supabase/migrations/   0001–0007 SQL — schema, indexes, MVs, read-only role
supabase/README.md     how to apply migrations + the read-only role step
pipeline/              Python 3.11+ — ingest + enrichment + orchestrator
  ingest, enrich_musicbrainz, enrich_discogs, enrich_claude, embed,
  liner_notes, derive_relationships, observe, run_pipeline
web/                   Next.js 14 (App Router, TS strict, Tailwind) — Vercel
  app/api/**           read endpoints + /api/query (text-to-SQL) + lists writes
  app/, components/    Library, Detail, Chat, Lists screens + design system
.github/workflows/     nightly.yml — scheduled + on-demand pipeline
```

Design + stack details: [`web/PERF.md`](web/PERF.md), [`supabase/README.md`](supabase/README.md).
A deviation from PROJECT_CONTEXT §4 (using `postgres` instead of
`@supabase/supabase-js` for raw SQL) is flagged in `web/PERF.md`.

---

# Setup — do these in order

> Anything needing your accounts/keys is below. Everything else is built.

## 1 · Supabase

1. Create a Supabase project (Postgres 15+).
2. **Apply migrations** in order (`supabase/README.md` has the exact commands) —
   SQL Editor, `psql`, or `supabase db push`. Uses `pgcrypto`, `citext`, `vector`.
3. **Read-only role**: run once with a password of your choosing —
   ```sql
   alter role crate_readonly with login password 'PICK_A_STRONG_PASSWORD';
   ```
4. Grab connection strings (Settings → Database):
   - **Transaction pooler**, port 6543 → `SUPABASE_DB_URL` (web)
   - **Session**, port 5432 → use for applying migrations
   - read-only pooler string → `SUPABASE_DB_URL_READONLY`
   And Settings → API → `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## 2 · Keys

- **Anthropic** → `ANTHROPIC_API_KEY` (tagging, liner notes, chat). Model: `claude-sonnet-4-6`.
- **Discogs** personal access token → `DISCOGS_TOKEN`.
- **MusicBrainz** → `MUSICBRAINZ_APP_CONTACT` = a real contact email (required in the UA).

Copy `.env.example` → `.env` and fill it in (used by the pipeline locally).

## 3 · First backfill (run locally, once)

Needs **Python 3.11+** (your machine currently has 3.9 — install 3.11+ first).
`fastembed` downloads a small ONNX model (BAAI/bge-large-en-v1.5, 1024-dim) on
first run.

```bash
cd "Tidal Music"
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r pipeline/requirements.txt

python -m pipeline.auth_tidal          # OAuth device login → writes .tidal-session.json
python -m pipeline.run_pipeline --backfill   # ingest + enrich everything, then stats + observation
```

`--backfill` loops the rate-limited workers (MusicBrainz is a hard 1 req/sec, so
the first pass over a big library takes a while — that's expected) until no jobs
remain. Re-running later only touches new tracks.

Spot-check:
```bash
psql "$SUPABASE_DB_URL" -c "select source,status,count(*) from enrichment_jobs group by 1,2;"
psql "$SUPABASE_DB_URL" -c "select count(*) from tracks where mbid is not null;"
psql "$SUPABASE_DB_URL" -c "select kind,body from observations order by created_at desc limit 3;"
```

## 4 · Deploy the web app (Vercel)

- Import the repo, **set the project root to `web/`**.
- Add env vars: `SUPABASE_DB_URL`, `SUPABASE_DB_URL_READONLY`, `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
  For the on-demand sync button also add `SYNC_SECRET`, `GITHUB_DISPATCH_TOKEN`
  (fine-grained PAT with Actions: write on this repo), `GITHUB_REPO=Hyphycodes/Tidal-Music`.
- Build command `next build`, output auto-detected. `postgres` is server-only.

Local dev: `cd web && npm install && npm run dev`.

## 5 · Nightly automation (GitHub Actions)

`.github/workflows/nightly.yml` runs `python -m pipeline.run_pipeline` nightly
(and on-demand via the web `/api/sync` → `repository_dispatch`). Add repo
**Actions secrets**:

| Secret | Value |
|--------|-------|
| `SUPABASE_DB_URL` | pooler connection string |
| `ANTHROPIC_API_KEY` | Anthropic key |
| `DISCOGS_TOKEN` | Discogs token |
| `MUSICBRAINZ_APP_CONTACT` | your contact email |
| `TIDAL_SESSION_JSON` | **contents** of your local `.tidal-session.json` (so CI can ingest) |

Deltas are tiny, so nightly runs are fast.

---

## Commands

```bash
# pipeline (each runnable + resumable; --limit chunks the rate-limited workers)
python -m pipeline.auth_tidal
python -m pipeline.ingest
python -m pipeline.enrich_musicbrainz --limit 500
python -m pipeline.enrich_discogs --limit 200
python -m pipeline.enrich_claude --limit 200
python -m pipeline.embed --limit 500
python -m pipeline.liner_notes --limit 200
python -m pipeline.derive_relationships
python -m pipeline.observe
python -m pipeline.run_pipeline [--backfill]

# web
cd web && npm run dev | npm run build | npm run typecheck
```

## Security

- All secrets live in env vars; `.env`, Tidal session files, and token caches are
  gitignored. Nothing secret is committed.
- The chat endpoint runs generated SQL as the `crate_readonly` role behind a SQL
  guard (single `SELECT` only) — it cannot mutate data by construction.
- The Supabase service key and DB URLs are server-only and never reach the client.
