"""MusicBrainz enrichment — the canonical facts layer.

    python -m pipeline.enrich_musicbrainz [--limit N]

ISRC → recording → artist(s) → release → label → country, writing canonical
rows + mbids. Respects MusicBrainz's HARD 1 request/second limit (the single
most important constraint here) and is fully resumable via `enrichment_jobs`.
"""
from __future__ import annotations

import argparse
import time
from typing import Any

import musicbrainzngs

from .config import configure_logging, settings
from .db import claim_jobs, connect, execute, fetchall, fetchval, finish_job, reset_stale_jobs, upsert

log = configure_logging()
SOURCE = "musicbrainz"


class RateLimiter:
    """Global ceiling of ≤1 request/second (hard MB limit). Counts requests so
    the run can prove it never exceeded the budget."""

    def __init__(self, min_interval: float = 1.0) -> None:
        self.min_interval = min_interval
        self.last = 0.0
        self.count = 0

    def wait(self) -> None:
        delta = time.monotonic() - self.last
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)
        self.last = time.monotonic()
        self.count += 1


rl = RateLimiter(1.0)


def _mb(fn: Any, *args: Any, **kwargs: Any) -> Any:
    """Rate-limited MB call with bounded retry on transient 503s (within budget)."""
    for attempt in range(3):
        rl.wait()
        try:
            return fn(*args, **kwargs)
        except musicbrainzngs.WebServiceError as e:
            if attempt == 2:
                raise
            log.warning("MB transient error (%s); backing off", e)
            time.sleep(2.0 * (attempt + 1))
    return None


# ── in-process caches (so repeated entities don't re-query the DB) ──────────
_artist_cache: dict[str, str] = {}   # lower(name) → artist id
_artist_detailed: set[str] = set()   # artist mbids whose area/began we already fetched
_label_cache: dict[str, str] = {}    # lower(name) → label id
_release_cache: dict[str, str] = {}  # release mbid → release id


def _upsert_artist(conn: Any, name: str, mbid: str | None, country: str | None, began: int | None) -> str:
    aid = fetchval(
        conn,
        """
        insert into artists (name, mbid, origin_country, began_year)
        values (%s, %s, %s, %s)
        on conflict (name) do update set
          mbid           = coalesce(excluded.mbid, artists.mbid),
          origin_country = coalesce(excluded.origin_country, artists.origin_country),
          began_year     = coalesce(excluded.began_year, artists.began_year),
          updated_at     = now()
        returning id
        """,
        [name, mbid, country, began],
    )
    _artist_cache[name.lower()] = aid
    return aid


def _upsert_label(conn: Any, name: str, country: str | None) -> str:
    key = name.lower()
    if key in _label_cache:
        return _label_cache[key]
    lid = fetchval(
        conn,
        """
        insert into labels (name, country) values (%s, %s)
        on conflict (name) do update set country = coalesce(excluded.country, labels.country), updated_at = now()
        returning id
        """,
        [name, country],
    )
    _label_cache[key] = lid
    return lid


def _upsert_release(conn: Any, mbid: str, title: str | None, year: int | None, country: str | None, label_id: str | None) -> str:
    if mbid in _release_cache:
        return _release_cache[mbid]
    rid = fetchval(
        conn,
        """
        insert into releases (mbid, title, year, country, label_id)
        values (%s, %s, %s, %s, %s)
        on conflict (mbid) where mbid is not null do update set
          title    = coalesce(excluded.title, releases.title),
          year     = coalesce(excluded.year, releases.year),
          country  = coalesce(excluded.country, releases.country),
          label_id = coalesce(excluded.label_id, releases.label_id),
          updated_at = now()
        returning id
        """,
        [mbid, title, year, country, label_id],
    )
    _release_cache[mbid] = rid
    return rid


def _year(s: Any) -> int | None:
    try:
        return int(str(s)[:4])
    except (ValueError, TypeError):
        return None


def _artist_origin(mbid: str | None) -> tuple[str | None, int | None]:
    """Fetch area/begin for an artist — once per mbid (cached), to bound requests."""
    if not mbid or mbid in _artist_detailed:
        return None, None
    _artist_detailed.add(mbid)
    try:
        res = _mb(musicbrainzngs.get_artist_by_id, mbid, includes=[])
        a = (res or {}).get("artist", {})
        area = (a.get("area") or a.get("begin-area") or {}).get("name")
        began = _year((a.get("life-span") or {}).get("begin"))
        return area, began
    except musicbrainzngs.WebServiceError:
        return None, None


def _pick_release(recording: dict) -> dict | None:
    rels = recording.get("release-list") or []
    if not rels:
        return None
    # prefer the earliest official release (the original, not a comp/reissue)
    def key(r: dict) -> tuple[int, str]:
        return (0 if r.get("status") == "Official" else 1, str(r.get("date") or "9999"))

    return sorted(rels, key=key)[0]


def _resolve(conn: Any, track: dict) -> str:
    """Resolve one track against MB. Returns job status: done | skipped."""
    isrc = track.get("isrc")
    recording: dict | None = None

    if isrc:
        res = _mb(musicbrainzngs.get_recordings_by_isrc, isrc, includes=["artists", "releases"])
        recs = (res or {}).get("isrc", {}).get("recording-list", [])
        recording = recs[0] if recs else None

    if recording is None:
        # constrained fallback search for ISRC-less / unmatched tracks
        res = _mb(
            musicbrainzngs.search_recordings,
            artist=track["artist_name"],
            recording=track["title"],
            release=track.get("album_title") or "",
            limit=5,
        )
        recs = (res or {}).get("recording-list", [])
        # only accept a strong score to avoid wrong canonical facts
        for r in recs:
            if int(r.get("ext:score", 0)) >= 90:
                recording = r
                break

    if recording is None:
        return "skipped"  # underground / no upstream data — graceful degrade

    rec_mbid = recording.get("id")

    # ── artists ──
    credits = recording.get("artist-credit") or []
    primary_artist_id: str | None = None
    for i, c in enumerate(credits):
        if not isinstance(c, dict) or "artist" not in c:
            continue
        art = c["artist"]
        name = art.get("name")
        ambid = art.get("id")
        if not name:
            continue
        country, began = _artist_origin(ambid) if i == 0 else (None, None)  # detail only the primary
        aid = _upsert_artist(conn, name, ambid, country, began)
        if i == 0:
            primary_artist_id = aid

    # ── release + label + country ──
    album_id: str | None = None
    release_date = None
    best = _pick_release(recording)
    if best and best.get("id"):
        rmbid = best["id"]
        label_id = None
        rel_country = best.get("country")
        rel_year = _year(best.get("date"))
        release_date = best.get("date")
        # one extra request to get label-info + (better) date/country
        try:
            full = _mb(musicbrainzngs.get_release_by_id, rmbid, includes=["labels"])
            rel = (full or {}).get("release", {})
            rel_country = rel.get("country") or rel_country
            rel_year = _year(rel.get("date")) or rel_year
            release_date = rel.get("date") or release_date
            for li in rel.get("label-info-list") or []:
                lab = (li.get("label") or {}).get("name")
                if lab:
                    label_id = _upsert_label(conn, lab, rel_country)
                    break
        except musicbrainzngs.WebServiceError:
            pass
        album_id = _upsert_release(conn, rmbid, best.get("title"), rel_year, rel_country, label_id)

    # ── write back onto the track ──
    rd = None
    if release_date and len(str(release_date)) >= 4:
        try:
            parts = str(release_date).split("-")
            rd = f"{parts[0]}-{(parts[1] if len(parts) > 1 else '01')}-{(parts[2] if len(parts) > 2 else '01')}"
        except Exception:  # noqa: BLE001
            rd = None
    execute(
        conn,
        """
        update tracks set
          mbid = coalesce(%s, mbid),
          primary_artist_id = coalesce(%s, primary_artist_id),
          album_id = coalesce(%s, album_id),
          release_date = coalesce(%s::date, release_date),
          enrichment_status = 'musicbrainz',
          updated_at = now()
        where id = %s
        """,
        [rec_mbid, primary_artist_id, album_id, rd, track["id"]],
    )

    # descriptor tags (verified facts: confidence 1.0)
    tag_rows = []
    if best and best.get("country"):
        tag_rows.append(
            {"entity_type": "track", "entity_id": track["id"], "tag": "country",
             "value": best["country"], "source": SOURCE, "confidence": 1.0}
        )
    if tag_rows:
        upsert(
            conn,
            "tags",
            tag_rows,
            conflict_target="entity_type, entity_id, tag, coalesce(value,''), source",
            update_cols=["confidence"],
        )
    return "done"


def run(limit: int = 500) -> None:
    settings.require("db_url", "musicbrainz_app_contact")
    musicbrainzngs.set_useragent(settings.app_name, settings.app_version, settings.musicbrainz_app_contact)
    musicbrainzngs.set_rate_limit(1.0, 1)  # backstop; rl enforces it too

    started = time.time()
    done = skipped = failed = 0
    with connect() as conn:
        recovered = reset_stale_jobs(conn, 15)
        if recovered:
            log.info("recovered %d stale running jobs", recovered)
        jobs = claim_jobs(conn, SOURCE, limit)
        log.info("claimed %d musicbrainz jobs", len(jobs))

        for job in jobs:
            track = fetchall(
                conn,
                "select id, isrc, title, artist_name, album_title from tracks where id = %s",
                [job["track_id"]],
            )
            if not track:
                finish_job(conn, job["id"], "skipped")
                skipped += 1
                continue
            try:
                status = _resolve(conn, track[0])
                conn.commit()
                finish_job(conn, job["id"], status)
                done += status == "done"
                skipped += status == "skipped"
            except Exception as e:  # noqa: BLE001 — one bad track never stops the run
                conn.rollback()
                finish_job(conn, job["id"], "retry", error=str(e), attempts=job["attempts"])
                failed += 1
                log.warning("track %s failed: %s", job["track_id"], e)

    elapsed = time.time() - started
    rate = rl.count / elapsed if elapsed else 0
    log.info(
        "musicbrainz done: done=%d skipped=%d failed=%d | %d requests in %.1fs (%.2f req/s, ceiling 1.0)",
        done, skipped, failed, rl.count, elapsed, rate,
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=500)
    run(ap.parse_args().limit)
