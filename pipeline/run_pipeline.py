"""Orchestrator — run the whole pipeline on deltas only.

    python -m pipeline.run_pipeline [--backfill]

Dependency order (each step processes only what's pending/new):
  1. ingest               (pull Tidal, upsert new tracks, enqueue jobs)
  2. enrich_musicbrainz   (pending MB jobs)
  3. enrich_discogs       (pending Discogs jobs)
  4. enrich_claude + embed(pending Claude jobs)
  5. liner_notes          (pending liner-notes jobs)
  6. derive_relationships (rebuild the artist graph)
  7. refresh_stats()      (REFRESH MATERIALIZED VIEW CONCURRENTLY)
  8. observe              (write today's single observation)

--backfill loops steps 2–5 in --limit chunks until no pending jobs remain, so a
fresh library fully enriches in one invocation (respecting rate limits). Every
step is wrapped so one failure never aborts the run; the whole thing is safe to
re-run (jobs + upserts).
"""
from __future__ import annotations

import argparse
import time

from . import (
    derive_relationships,
    embed,
    enrich_claude,
    enrich_discogs,
    enrich_musicbrainz,
    ingest,
    liner_notes,
    observe,
)
from .config import configure_logging
from .db import connect, execute, fetchval

log = configure_logging()

MB_CHUNK, DISCOGS_CHUNK, CLAUDE_CHUNK, EMBED_CHUNK, LINER_CHUNK = 400, 150, 200, 500, 200


def _step(name: str, fn, *args) -> bool:
    try:
        fn(*args)
        return True
    except SystemExit as e:  # e.g. missing Tidal session — log and keep going
        log.warning("step %s skipped: %s", name, e)
    except Exception as e:  # noqa: BLE001
        log.error("step %s errored: %s", name, e)
    return False


def _pending() -> int:
    with connect() as conn:
        return int(fetchval(conn, "select count(*) from enrichment_jobs where status='pending'") or 0)


def _enrich_once() -> None:
    _step("musicbrainz", enrich_musicbrainz.run, MB_CHUNK)
    _step("discogs", enrich_discogs.run, DISCOGS_CHUNK)
    _step("claude", enrich_claude.run, CLAUDE_CHUNK)
    _step("embed", embed.run, EMBED_CHUNK)
    _step("liner_notes", liner_notes.run, LINER_CHUNK)


def run(backfill: bool = False) -> None:
    started = time.time()
    log.info("── pipeline start (%s) ──", "backfill" if backfill else "delta")

    _step("ingest", ingest.run)

    if backfill:
        loops = 0
        while loops < 100:
            loops += 1
            before = _pending()
            log.info("backfill loop %d — %d pending jobs", loops, before)
            if before == 0:
                break
            _enrich_once()
            after = _pending()
            if after >= before:  # no forward progress (all remaining are failing) → stop
                log.info("backfill: no further progress (%d pending) — stopping", after)
                break
    else:
        _enrich_once()

    _step("derive_relationships", derive_relationships.run)
    _step("refresh_stats", lambda: _refresh_stats())
    _step("observe", observe.run)

    log.info("── pipeline done in %.1fs ──", time.time() - started)


def _refresh_stats() -> None:
    with connect() as conn:
        execute(conn, "select refresh_stats()")
    log.info("stats refreshed")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", action="store_true", help="loop enrichment until no pending jobs remain")
    run(ap.parse_args().backfill)
