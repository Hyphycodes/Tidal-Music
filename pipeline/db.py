"""Database helpers shared by every pipeline worker.

Design goals (speed doctrine §3.5/§3.6):
  * idempotent upserts only — ``INSERT … ON CONFLICT`` keyed on natural keys
  * batch all writes — never one row per statement
  * the job table *is* the progress log — claim/finish helpers are atomic
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterable, Iterator, Sequence

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from .config import settings

log = logging.getLogger("crate.db")

Row = dict[str, Any]


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Session connection (port 5432). Commits on success, rolls back on error."""
    settings.require("db_url")
    conn = psycopg.connect(settings.db_url, autocommit=False)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _chunks(seq: Sequence[Any], n: int) -> Iterator[Sequence[Any]]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def upsert(
    conn: psycopg.Connection,
    table: str,
    rows: Sequence[Row],
    conflict_target: str,
    update_cols: Sequence[str] | None = None,
    returning: Sequence[str] | None = None,
    batch_size: int = 500,
) -> list[Row]:
    """Batched ``INSERT … ON CONFLICT``.

    ``conflict_target`` is raw SQL inside the parens — e.g. ``"tidal_id"`` or
    ``"entity_type, entity_id, tag, coalesce(value,''), source"``. It is
    developer-controlled, never user input.

    With ``update_cols`` → ``DO UPDATE SET col = EXCLUDED.col``; without →
    ``DO NOTHING`` (so ``returning`` yields only the rows actually inserted —
    exactly what ingest needs to know which tracks are genuinely new).
    """
    if not rows:
        return []
    cols = list(rows[0].keys())
    col_ident = sql.SQL(", ").join(sql.Identifier(c) for c in cols)

    if update_cols:
        set_clause = sql.SQL(", ").join(
            sql.SQL("{c} = EXCLUDED.{c}").format(c=sql.Identifier(c)) for c in update_cols
        )
        conflict_action = sql.SQL("DO UPDATE SET {}").format(set_clause)
    else:
        conflict_action = sql.SQL("DO NOTHING")

    returning_sql = (
        sql.SQL(" RETURNING {}").format(sql.SQL(", ").join(sql.Identifier(c) for c in returning))
        if returning
        else sql.SQL("")
    )

    out: list[Row] = []
    with conn.cursor(row_factory=dict_row) as cur:
        placeholders = sql.SQL(", ").join([sql.Placeholder()] * len(cols))
        one_row = sql.SQL("({})").format(placeholders)
        for chunk in _chunks(rows, batch_size):
            values_sql = sql.SQL(", ").join([one_row] * len(chunk))
            stmt = sql.SQL(
                "INSERT INTO {tbl} ({cols}) VALUES {vals} ON CONFLICT ({conflict}) {action}{ret}"
            ).format(
                tbl=sql.Identifier(table),
                cols=col_ident,
                vals=values_sql,
                conflict=sql.SQL(conflict_target),
                action=conflict_action,
                ret=returning_sql,
            )
            params = [row[c] for row in chunk for c in cols]
            cur.execute(stmt, params)
            if returning:
                out.extend(cur.fetchall())
    return out


def fetchall(conn: psycopg.Connection, query: str, params: Sequence[Any] | None = None) -> list[Row]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(query, params or [])
        return cur.fetchall()


def fetchval(conn: psycopg.Connection, query: str, params: Sequence[Any] | None = None) -> Any:
    with conn.cursor() as cur:
        cur.execute(query, params or [])
        r = cur.fetchone()
        return r[0] if r else None


def execute(conn: psycopg.Connection, query: str, params: Sequence[Any] | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(query, params or [])


# ── enrichment job model (§6) ───────────────────────────────────────────────

JOB_SOURCES = ("musicbrainz", "discogs", "claude", "liner_notes")


def enqueue_jobs(conn: psycopg.Connection, track_ids: Iterable[str], sources: Iterable[str]) -> int:
    """One pending job per (track, source). Idempotent via the unique constraint."""
    rows = [{"track_id": tid, "source": s} for tid in track_ids for s in sources]
    if not rows:
        return 0
    upsert(conn, "enrichment_jobs", rows, conflict_target="track_id, source")
    return len(rows)


def reset_stale_jobs(conn: psycopg.Connection, minutes: int = 15) -> int:
    """Flip 'running' jobs older than `minutes` back to 'pending' (recover crashes)."""
    return int(fetchval(conn, "select reset_stale_jobs(%s)", [minutes]) or 0)


def claim_jobs(conn: psycopg.Connection, source: str, limit: int) -> list[Row]:
    """Atomically claim up to `limit` pending jobs for `source` (oldest first).

    Uses FOR UPDATE SKIP LOCKED so concurrent workers never grab the same job.
    Commits immediately so the 'running' marks are durable even if the worker
    is killed mid-batch (reset_stale_jobs recovers them later).
    """
    rows = fetchall(
        conn,
        """
        with claimed as (
          select id from enrichment_jobs
           where source = %s and status = 'pending'
           order by updated_at asc
           limit %s
           for update skip locked
        )
        update enrichment_jobs j
           set status = 'running', started_at = now(), updated_at = now()
          from claimed
         where j.id = claimed.id
        returning j.id, j.track_id, j.attempts
        """,
        [source, limit],
    )
    conn.commit()
    return rows


def finish_job(
    conn: psycopg.Connection,
    job_id: str,
    status: str,
    *,
    error: str | None = None,
    attempts: int | None = None,
) -> None:
    """Mark a job done/skipped/failed/pending. `status='retry'` is a convenience
    that re-queues (pending) or fails after 3 attempts."""
    if status == "retry":
        n = (attempts or 0) + 1
        new_status = "failed" if n >= 3 else "pending"
        execute(
            conn,
            "update enrichment_jobs set status=%s, attempts=%s, last_error=%s, updated_at=now() where id=%s",
            [new_status, n, (error or "")[:2000], job_id],
        )
    else:
        execute(
            conn,
            "update enrichment_jobs set status=%s, last_error=%s, updated_at=now() where id=%s",
            [status, (error[:2000] if error else None), job_id],
        )
    conn.commit()
