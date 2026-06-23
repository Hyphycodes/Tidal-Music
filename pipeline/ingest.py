"""Tidal ingest — mirror favorites + playlists into Postgres, enqueue enrichment.

    python -m pipeline.ingest

Fast on every run after the first: it loads existing state in ONE query, diffs
in-process, and only upserts genuinely new tracks (then enqueues their jobs).
Touches Tidal over the network (the only slow part); never adds per-row DB
round-trips. See PROJECT_CONTEXT §6 for the enrich-once model.
"""
from __future__ import annotations

import datetime as dt
import time
from typing import Any, Callable

from .auth_tidal import load_session
from .config import configure_logging, settings
from .db import JOB_SOURCES, connect, enqueue_jobs, fetchall, upsert

log = configure_logging()
TrackDict = dict[str, Any]


# ── small resilience helpers ────────────────────────────────────────────────
def _retry(fn: Callable[[], Any], *, tries: int = 4, base: float = 1.0) -> Any:
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 — bounded retry on any transient Tidal error
            if i == tries - 1:
                raise
            wait = base * (2**i)
            log.warning("transient Tidal error (%s); retry in %.1fs", e, wait)
            time.sleep(wait)


def _parse_dt(v: Any) -> dt.datetime | None:
    if not v:
        return None
    if isinstance(v, dt.datetime):
        return v
    try:
        return dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_date(v: Any) -> dt.date | None:
    d = _parse_dt(v)
    if d:
        return d.date()
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except (ValueError, TypeError):
        return None


# ── shaping a uniform track dict from either raw JSON or a tidalapi object ───
def _track_from_json(tj: dict, saved_at: dt.datetime | None) -> TrackDict:
    raw = tj.get("artists") or ([tj["artist"]] if tj.get("artist") else [])
    artists = [{"id": str(a.get("id", "")), "name": a["name"]} for a in raw if a.get("name")]
    album = tj.get("album") or {}
    return {
        "tidal_id": str(tj.get("id", "")),
        "title": tj.get("title") or "Untitled",
        "artist_name": artists[0]["name"] if artists else "Unknown",
        "album_title": album.get("title"),
        "isrc": tj.get("isrc"),
        "duration_sec": tj.get("duration"),
        "release_date": _parse_date(tj.get("streamStartDate") or album.get("releaseDate")),
        "genre": None,
        "saved_at": saved_at,
        "_artists": artists,
    }


def _track_from_obj(tr: Any, saved_at: dt.datetime | None) -> TrackDict:
    raw = getattr(tr, "artists", None) or ([getattr(tr, "artist", None)] if getattr(tr, "artist", None) else [])
    artists = []
    for a in raw:
        nm = getattr(a, "name", None)
        if nm:
            artists.append({"id": str(getattr(a, "id", "")), "name": nm})
    album = getattr(tr, "album", None)
    rel = getattr(tr, "tidal_release_date", None) or (getattr(album, "release_date", None) if album else None)
    return {
        "tidal_id": str(getattr(tr, "id", "")),
        "title": getattr(tr, "name", None) or "Untitled",
        "artist_name": artists[0]["name"] if artists else "Unknown",
        "album_title": getattr(album, "name", None) if album else None,
        "isrc": getattr(tr, "isrc", None),
        "duration_sec": getattr(tr, "duration", None),
        "release_date": _parse_date(rel),
        "genre": None,
        "saved_at": saved_at,
        "_artists": artists,
    }


# ── Tidal pulls (fully paginated) ────────────────────────────────────────────
def _raw_favorites(session: Any) -> list[dict] | None:
    """Preferred path: the raw favorites endpoint carries the `created` (saved) date.

    Returns a list of {created, item} dicts, or None if the low-level request
    isn't available in this tidalapi version (we then fall back to objects)."""
    try:
        user_id = session.user.id
    except Exception:  # noqa: BLE001
        return None
    items: list[dict] = []
    offset, limit = 0, 100
    while True:
        def _go() -> dict:
            resp = session.request.request(
                "GET",
                f"users/{user_id}/favorites/tracks",
                params={"limit": limit, "offset": offset, "order": "DATE", "orderDirection": "DESC"},
            )
            return resp.json()

        try:
            data = _retry(_go)
        except Exception as e:  # noqa: BLE001
            log.warning("raw favorites endpoint unavailable (%s); using client objects", e)
            return None
        chunk = data.get("items", [])
        items.extend(chunk)
        offset += limit
        if len(chunk) < limit:
            break
    return items


def _client_favorites(session: Any) -> list[Any]:
    out: list[Any] = []
    offset, limit = 0, 100
    while True:
        chunk = _retry(lambda: session.user.favorites.tracks(limit=limit, offset=offset)) or []
        out.extend(chunk)
        offset += limit
        if len(chunk) < limit:
            break
    return out


def _all_playlist_tracks(pl: Any) -> list[Any]:
    out: list[Any] = []
    offset, limit = 0, 100
    while True:
        try:
            chunk = _retry(lambda: pl.tracks(limit=limit, offset=offset)) or []
        except Exception as e:  # noqa: BLE001
            log.warning("playlist '%s' page failed (%s); skipping rest", getattr(pl, "name", "?"), e)
            break
        out.extend(chunk)
        offset += limit
        if len(chunk) < limit:
            break
    return out


def pull_library(session: Any) -> tuple[dict[str, TrackDict], list[dict]]:
    """Pull favorites ∪ playlist tracks. Returns (tracks_by_tidal_id, playlists)."""
    tracks: dict[str, TrackDict] = {}

    fav_items = _raw_favorites(session)
    if fav_items is not None:
        for it in fav_items:
            tj = it.get("item") or {}
            td = _track_from_json(tj, _parse_dt(it.get("created")))
            if td["tidal_id"]:
                tracks[td["tidal_id"]] = td
        log.info("favorites (raw): %d", len(fav_items))
    else:
        objs = _client_favorites(session)
        for tr in objs:
            td = _track_from_obj(tr, None)  # no precise saved date on this path
            if td["tidal_id"]:
                tracks[td["tidal_id"]] = td
        log.info("favorites (objects): %d", len(objs))

    playlists: list[dict] = []
    try:
        user_playlists = _retry(lambda: session.user.playlists()) or []
    except Exception as e:  # noqa: BLE001
        log.warning("could not list playlists (%s)", e)
        user_playlists = []
    for pl in user_playlists:
        tids: list[str] = []
        for tr in _all_playlist_tracks(pl):
            td = _track_from_obj(tr, None)
            if not td["tidal_id"]:
                continue
            tids.append(td["tidal_id"])
            tracks.setdefault(td["tidal_id"], td)  # keep favorite's saved_at if already present
        playlists.append({"tidal_id": str(getattr(pl, "id", "")), "title": getattr(pl, "name", "Untitled"), "tids": tids})
    log.info("playlists: %d  | universe: %d tracks", len(playlists), len(tracks))
    return tracks, playlists


# ── diff + upsert ─────────────────────────────────────────────────────────────
def run() -> None:
    settings.require("db_url", "tidal_session_file")
    session = load_session(settings.tidal_session_file)
    if session is None:
        raise SystemExit("No valid Tidal session. Run: python -m pipeline.auth_tidal")

    started = time.time()
    tracks, playlists = pull_library(session)
    now = dt.datetime.now(dt.timezone.utc)

    with connect() as conn:
        existing = {
            r["tidal_id"]: r
            for r in fetchall(conn, "select tidal_id, isrc from tracks")
        }
        existing_isrcs = {r["isrc"] for r in existing.values() if r["isrc"]}

        # partition: genuinely new vs already present
        new_tids = [tid for tid in tracks if tid not in existing]

        # de-dup new tracks by ISRC (same recording collapses to one row)
        seen_isrc = set(existing_isrcs)
        new_tracks: list[TrackDict] = []
        isrc_dupes = 0
        for tid in new_tids:
            td = tracks[tid]
            isrc = td.get("isrc")
            if isrc:
                if isrc in seen_isrc:
                    isrc_dupes += 1
                    continue
                seen_isrc.add(isrc)
            new_tracks.append(td)

        # upsert artists referenced by new tracks (by name), build name→id
        artist_names = {a["name"] for td in new_tracks for a in td["_artists"]}
        if artist_names:
            upsert(conn, "artists", [{"name": n} for n in artist_names], conflict_target="name")
        name_to_id: dict[str, str] = {}
        if artist_names:
            for r in fetchall(conn, "select id, name from artists where name = any(%s)", [list(artist_names)]):
                name_to_id[str(r["name"]).lower()] = r["id"]

        # build + insert track rows
        fallback_dates = 0
        track_rows: list[dict] = []
        for td in new_tracks:
            saved = td["saved_at"]
            if not saved:
                saved = now
                fallback_dates += 1
            primary = td["_artists"][0]["name"] if td["_artists"] else td["artist_name"]
            track_rows.append(
                {
                    "tidal_id": td["tidal_id"],
                    "isrc": td["isrc"],
                    "title": td["title"],
                    "artist_name": td["artist_name"],
                    "album_title": td["album_title"],
                    "primary_artist_id": name_to_id.get(primary.lower()),
                    "duration_sec": td["duration_sec"],
                    "release_date": td["release_date"],
                    "saved_at": saved,
                    "genre": td["genre"],
                    "enrichment_status": "pending",
                }
            )
        inserted = upsert(conn, "tracks", track_rows, conflict_target="tidal_id", returning=["id", "tidal_id"])
        new_ids = [r["id"] for r in inserted]

        # map every pulled tidal_id → track id (for track_artists + playlist_tracks)
        all_tids = list(tracks.keys())
        tid_to_id: dict[str, str] = {}
        for r in fetchall(conn, "select id, tidal_id from tracks where tidal_id = any(%s)", [all_tids]):
            tid_to_id[r["tidal_id"]] = r["id"]

        # track_artists for new tracks (main + features)
        ta_rows: list[dict] = []
        for td in new_tracks:
            tkid = tid_to_id.get(td["tidal_id"])
            if not tkid:
                continue
            for i, a in enumerate(td["_artists"]):
                aid = name_to_id.get(a["name"].lower())
                if aid:
                    ta_rows.append({"track_id": tkid, "artist_id": aid, "role": "main" if i == 0 else "featured"})
        if ta_rows:
            upsert(conn, "track_artists", ta_rows, conflict_target="track_id, artist_id, role")

        # playlists + membership (the "presented self")
        if playlists:
            upsert(
                conn,
                "playlists",
                [{"tidal_id": p["tidal_id"], "title": p["title"]} for p in playlists if p["tidal_id"]],
                conflict_target="tidal_id",
                update_cols=["title"],
            )
            pl_ids = {
                r["tidal_id"]: r["id"]
                for r in fetchall(
                    conn,
                    "select id, tidal_id from playlists where tidal_id = any(%s)",
                    [[p["tidal_id"] for p in playlists if p["tidal_id"]]],
                )
            }
            pt_seen: set[tuple[str, str]] = set()
            pt_rows: list[dict] = []
            for p in playlists:
                plid = pl_ids.get(p["tidal_id"])
                if not plid:
                    continue
                for tid in p["tids"]:
                    tkid = tid_to_id.get(tid)
                    if tkid and (plid, tkid) not in pt_seen:
                        pt_seen.add((plid, tkid))
                        pt_rows.append({"playlist_id": plid, "track_id": tkid})
            if pt_rows:
                upsert(conn, "playlist_tracks", pt_rows, conflict_target="playlist_id, track_id")

        # enqueue 4 pending jobs per genuinely-new track
        enqueue_jobs(conn, new_ids, JOB_SOURCES)

    seen = len(tracks)
    skipped = seen - len(inserted)
    log.info(
        "ingest done: seen=%d new=%d skipped=%d (isrc_dupes=%d, fallback_dates=%d) in %.1fs",
        seen,
        len(inserted),
        skipped,
        isrc_dupes,
        fallback_dates,
        time.time() - started,
    )
    if fallback_dates:
        log.warning("%d new tracks had no saved date — used now() as a fallback", fallback_dates)


if __name__ == "__main__":
    run()
