"""Discogs enrichment — the human layer (producers, engineers, players, features).

    python -m pipeline.enrich_discogs [--limit N]

Discogs has no reliable ISRC, so matching is fuzzy and lossy. We score
candidates and only accept confident matches (else `skipped` — a normal, common
outcome for underground catalog). Writes `people` + `credits` with normalized
roles. Respects the ~60 req/min authenticated limit and is resumable.
"""
from __future__ import annotations

import argparse
import re
import time
from difflib import SequenceMatcher
from typing import Any

import discogs_client
from discogs_client.exceptions import HTTPError

from .config import configure_logging, settings
from .db import claim_jobs, connect, execute, fetchall, fetchval, finish_job, reset_stale_jobs, upsert

log = configure_logging()
SOURCE = "discogs"
MATCH_THRESHOLD = 0.55  # below this → skip rather than write wrong credits

# controlled role vocabulary
_ROLE_MAP = [
    ("produc", "producer"),
    ("mix", "engineer"),
    ("master", "engineer"),
    ("engineer", "engineer"),
    ("record", "engineer"),
    ("written", "writer"),
    ("write", "writer"),
    ("compos", "writer"),
    ("lyric", "writer"),
    ("songwriter", "writer"),
    ("feat", "featuring"),
]


def normalize(s: str | None) -> str:
    s = (s or "").lower()
    s = re.sub(r"\(feat[^)]*\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def score_match(track_artist: str, track_title: str, track_album: str | None, candidate_title: str) -> float:
    """Pure, testable match score in [0,1].

    `candidate_title` is Discogs' "Artist - Release" string. We blend overall
    string similarity with how many of the artist's tokens appear in the
    candidate, which is robust to title/album word-order differences.
    """
    want = normalize(f"{track_artist} {track_album or track_title}")
    got = normalize(candidate_title)
    s = similarity(want, got)
    at = set(normalize(track_artist).split())
    gt = set(got.split())
    overlap = len(at & gt) / (len(at) or 1)
    return round(min(1.0, 0.7 * s + 0.3 * overlap), 4)


def normalize_role(raw: str | None) -> str:
    r = (raw or "").lower()
    for needle, role in _ROLE_MAP:
        if needle in r:
            return role
    return "performer"


class RateLimiter:
    def __init__(self, min_interval: float = 1.1) -> None:  # ~55/min, under the 60/min ceiling
        self.min_interval = min_interval
        self.last = 0.0
        self.count = 0

    def wait(self) -> None:
        delta = time.monotonic() - self.last
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)
        self.last = time.monotonic()
        self.count += 1


rl = RateLimiter()
_person_cache: dict[str, str] = {}


def _dc(fn: Any, *args: Any, **kwargs: Any) -> Any:
    """Rate-limited Discogs call; backs off on 429."""
    for attempt in range(3):
        rl.wait()
        try:
            return fn(*args, **kwargs)
        except HTTPError as e:
            if getattr(e, "status_code", None) == 429 and attempt < 2:
                log.warning("discogs 429 — backing off 60s")
                time.sleep(60)
                continue
            raise


def _upsert_person(conn: Any, name: str) -> str:
    key = name.lower()
    if key in _person_cache:
        return _person_cache[key]
    pid = fetchval(
        conn,
        "insert into people (name) values (%s) on conflict (name) do update set updated_at = now() returning id",
        [name],
    )
    _person_cache[key] = pid
    return pid


def _best_candidate(client: Any, track: dict) -> tuple[Any | None, float]:
    query = f"{track['artist_name']} {track.get('album_title') or track['title']}"
    try:
        results = _dc(client.search, query, type="release")
    except HTTPError as e:
        log.warning("discogs search failed for %s (%s)", track["id"], e)
        return None, 0.0
    best, best_score = None, 0.0
    # only inspect the first handful of the first page (one request)
    try:
        page = list(results.page(0))[:6] if hasattr(results, "page") else list(results)[:6]
    except (HTTPError, IndexError):
        page = []
    for r in page:
        title = getattr(r, "title", "") or ""
        sc = score_match(track["artist_name"], track["title"], track.get("album_title"), title)
        if sc > best_score:
            best, best_score = r, sc
    return best, best_score


def _resolve(conn: Any, client: Any, track: dict) -> str:
    cand, score = _best_candidate(client, track)
    if cand is None or score < MATCH_THRESHOLD:
        return "skipped"  # no confident match — better than wrong credits

    rel = _dc(client.release, cand.id)
    extra = (getattr(rel, "data", {}) or {}).get("extraartists", []) or []

    credit_rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for ea in extra:
        name = (ea.get("name") or "").strip()
        if not name:
            continue
        role = normalize_role(ea.get("role"))
        pid = _upsert_person(conn, name)
        keyp = (pid, role)
        if keyp in seen:
            continue
        seen.add(keyp)
        credit_rows.append(
            {"track_id": track["id"], "person_id": pid, "role": role, "source": SOURCE, "confidence": score}
        )

    if credit_rows:
        upsert(
            conn,
            "credits",
            credit_rows,
            conflict_target="track_id, person_id, role",
            update_cols=["source", "confidence"],
        )
    execute(conn, "update tracks set enrichment_status = 'discogs', updated_at = now() where id = %s", [track["id"]])
    return "done" if credit_rows else "skipped"


def run(limit: int = 200) -> None:
    settings.require("db_url", "discogs_token")
    client = discogs_client.Client(f"{settings.app_name}/{settings.app_version}", user_token=settings.discogs_token)

    started = time.time()
    done = skipped = failed = 0
    with connect() as conn:
        reset_stale_jobs(conn, 15)
        jobs = claim_jobs(conn, SOURCE, limit)
        log.info("claimed %d discogs jobs", len(jobs))

        for job in jobs:
            rows = fetchall(
                conn, "select id, title, artist_name, album_title from tracks where id = %s", [job["track_id"]]
            )
            if not rows:
                finish_job(conn, job["id"], "skipped")
                skipped += 1
                continue
            try:
                status = _resolve(conn, client, rows[0])
                conn.commit()
                finish_job(conn, job["id"], status)
                done += status == "done"
                skipped += status == "skipped"
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                finish_job(conn, job["id"], "retry", error=str(e), attempts=job["attempts"])
                failed += 1
                log.warning("track %s failed: %s", job["track_id"], e)

    n = done + skipped + failed
    log.info(
        "discogs done: done=%d skipped=%d failed=%d (skip rate %.0f%%) | %d requests in %.1fs",
        done, skipped, failed, (100 * skipped / n if n else 0), rl.count, time.time() - started,
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=200)
    run(ap.parse_args().limit)
