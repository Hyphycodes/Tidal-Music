"""Liner notes — the "learn about my music" narrative.

    python -m pipeline.liner_notes [--limit N] [--entity artist|release] [--force]

One note per artist and one per release in the library, grounded in the
VERIFIED facts we already hold (labels, era, producers, personnel). Stored once
in `narratives`; never regenerated unless --force. This keeps the fact/inference
line intact — the note is source='claude' and the UI labels it interpretation.
"""
from __future__ import annotations

import argparse
import time
from typing import Any

import anthropic

from .config import configure_logging, settings
from .db import claim_jobs, connect, execute, fetchall, fetchval, finish_job, reset_stale_jobs

log = configure_logging()
SOURCE = "liner_notes"

SYSTEM = (
    "You write record-store liner notes: knowledgeable, understated, no hype. "
    "Use ONLY the verified facts provided. Do NOT invent specific dates, personnel, "
    "chart positions, sales, or quotes beyond what is given — if something is unknown, "
    "speak generally and qualitatively. Write a few short paragraphs. If little is "
    "documented, say so briefly and keep it short. Plain prose, no headings."
)

_artist_seen: set[str] = set()
_release_seen: set[str] = set()


def _generate(client: Any, instruction: str, facts: str) -> str:
    for attempt in range(2):
        resp = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=600,
            system=SYSTEM,
            messages=[{"role": "user", "content": f"{instruction}\n\nVERIFIED FACTS:\n{facts}"}],
        )
        body = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
        if body:
            return body
    return ""


def _facts_lines(pairs: list[tuple[str, Any]]) -> str:
    out = []
    for label, val in pairs:
        if isinstance(val, (list, tuple)):
            val = ", ".join(str(v) for v in val if v)
        if val:
            out.append(f"- {label}: {val}")
    return "\n".join(out) if out else "- (very little is documented)"


def ensure_artist_note(conn: Any, client: Any, artist_id: str, force: bool) -> None:
    if artist_id in _artist_seen:
        return
    _artist_seen.add(artist_id)
    if not force and fetchval(
        conn, "select 1 from narratives where entity_type='artist' and entity_id=%s", [artist_id]
    ):
        return
    a = fetchall(conn, "select name, origin_city, origin_country, began_year, scene from artists where id=%s", [artist_id])
    if not a:
        return
    a = a[0]
    labels = [r["name"] for r in fetchall(
        conn,
        """select distinct l.name from tracks t
             join releases r on r.id=t.album_id join labels l on l.id=r.label_id
            where t.primary_artist_id=%s limit 10""",
        [artist_id],
    )]
    collabs = [f"{r['name']} ({r['role']})" for r in fetchall(
        conn,
        """select distinct p.name, c.role from credits c
             join people p on p.id=c.person_id join tracks t on t.id=c.track_id
            where t.primary_artist_id=%s limit 15""",
        [artist_id],
    )]
    titles = [r["title"] for r in fetchall(conn, "select title from tracks where primary_artist_id=%s limit 15", [artist_id])]
    facts = _facts_lines([
        ("Artist", a["name"]),
        ("Origin", ", ".join(x for x in [a.get("origin_city"), a.get("origin_country")] if x)),
        ("Active since", a.get("began_year")),
        ("Scene", a.get("scene")),
        ("Labels in this library", labels),
        ("Collaborators / personnel credited", collabs),
        ("Tracks I've saved", titles),
    ])
    body = _generate(client, f"Write a liner note about the artist {a['name']}.", facts)
    if not body:
        body = f"Little is documented about {a['name']} in the sources at hand."
    execute(
        conn,
        """insert into narratives (entity_type, entity_id, body, source, model)
           values ('artist', %s, %s, 'claude', %s)
           on conflict (entity_type, entity_id) do update set body=excluded.body, model=excluded.model, created_at=now()""",
        [artist_id, body, settings.anthropic_model],
    )


def ensure_release_note(conn: Any, client: Any, release_id: str, force: bool) -> None:
    if release_id in _release_seen:
        return
    _release_seen.add(release_id)
    if not force and fetchval(
        conn, "select 1 from narratives where entity_type='release' and entity_id=%s", [release_id]
    ):
        return
    r = fetchall(
        conn,
        "select r.title, r.year, r.country, l.name as label from releases r left join labels l on l.id=r.label_id where r.id=%s",
        [release_id],
    )
    if not r or not r[0]["title"]:
        return
    r = r[0]
    personnel = [f"{x['name']} ({x['role']})" for x in fetchall(
        conn,
        """select distinct p.name, c.role from credits c
             join people p on p.id=c.person_id join tracks t on t.id=c.track_id
            where t.album_id=%s limit 20""",
        [release_id],
    )]
    facts = _facts_lines([
        ("Release", r["title"]),
        ("Year", r.get("year")),
        ("Country", r.get("country")),
        ("Label", r.get("label")),
        ("Personnel", personnel),
    ])
    body = _generate(client, f"Write a liner note about the release \"{r['title']}\".", facts)
    if not body:
        body = f"Little is documented about \"{r['title']}\" in the sources at hand."
    execute(
        conn,
        """insert into narratives (entity_type, entity_id, body, source, model)
           values ('release', %s, %s, 'claude', %s)
           on conflict (entity_type, entity_id) do update set body=excluded.body, model=excluded.model, created_at=now()""",
        [release_id, body, settings.anthropic_model],
    )


def run(limit: int = 200, entity: str | None = None, force: bool = False) -> None:
    settings.require("db_url", "anthropic_api_key")
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    started = time.time()
    artists = releases = 0

    with connect() as conn:
        reset_stale_jobs(conn, 15)

        # targeted mode: regenerate a single entity type, don't touch jobs
        if entity in ("artist", "release"):
            col = "primary_artist_id" if entity == "artist" else "album_id"
            ids = [r[col] for r in fetchall(
                conn,
                f"""select distinct t.{col} from tracks t
                      join enrichment_jobs j on j.track_id=t.id
                     where j.source='liner_notes' and j.status in ('pending','done') and t.{col} is not null
                     limit %s""",
                [limit],
            )]
            for eid in ids:
                if entity == "artist":
                    ensure_artist_note(conn, client, eid, force); artists += 1
                else:
                    ensure_release_note(conn, client, eid, force); releases += 1
                conn.commit()
            log.info("liner_notes (targeted %s): generated/checked artists=%d releases=%d in %.1fs",
                     entity, artists, releases, time.time() - started)
            return

        # normal mode: claim pending jobs, generate both entity notes, mark done
        jobs = claim_jobs(conn, SOURCE, limit)
        log.info("claimed %d liner_notes jobs", len(jobs))
        done = failed = 0
        for job in jobs:
            t = fetchall(conn, "select primary_artist_id, album_id from tracks where id=%s", [job["track_id"]])
            t = t[0] if t else {}
            try:
                if t.get("primary_artist_id"):
                    ensure_artist_note(conn, client, t["primary_artist_id"], force)
                if t.get("album_id"):
                    ensure_release_note(conn, client, t["album_id"], force)
                conn.commit()
                finish_job(conn, job["id"], "done")
                done += 1
            except anthropic.APIError as e:
                conn.rollback()
                finish_job(conn, job["id"], "retry", error=str(e), attempts=job["attempts"])
                failed += 1
                log.warning("liner note for track %s failed: %s", job["track_id"], e)

        log.info(
            "liner_notes done: jobs done=%d failed=%d | unique artists=%d releases=%d | %.1fs",
            done, failed, len(_artist_seen), len(_release_seen), time.time() - started,
        )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--entity", choices=["artist", "release"], default=None)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    run(a.limit, a.entity, a.force)
