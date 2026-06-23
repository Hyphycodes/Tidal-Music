"""Claude tagging — the subjective layer (energy / mood / scene / era).

    python -m pipeline.enrich_claude [--limit N]

One Claude call per track, ever — written permanently, never re-asked (so API
spend stays near zero after the first pass). Output is INFERENCE, not fact:
everything is stored with source='claude' + a confidence so the UI can mark it.
"""
from __future__ import annotations

import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import anthropic

from .config import configure_logging, settings
from .db import claim_jobs, connect, execute, fetchall, finish_job, reset_stale_jobs, upsert

log = configure_logging()
SOURCE = "claude"
CONCURRENCY = 5

SYSTEM = (
    "You are a meticulous music cataloguer with deep knowledge of global scenes "
    "(Afrobeats, Afro house, deep house, hip-hop, R&B, bossa/cinematic). Given a "
    "track's known metadata, infer its sonic and cultural dimensions. Return STRICT "
    "JSON ONLY — no prose, no markdown fences — exactly this shape:\n"
    '{"energy": <int 1-10>, "mood": ["..."], "scene": "<specific scene, e.g. '
    "'Lagos Afrobeats', 'SA Afro house', 'Brazilian bossa'>\", "
    '"era": "<decade or movement>", "confidence": <float 0-1>}\n'
    "energy: 1=ambient/sparse, 10=peak-time. mood: 1-4 lowercase adjectives. "
    "If metadata is thin, still answer but lower the confidence. Never add fields "
    "or commentary."
)


def _user_text(t: dict) -> str:
    lines = [f"Title: {t['title']}", f"Artist: {t['artist_name']}"]
    if t.get("album_title"):
        lines.append(f"Album: {t['album_title']}")
    if t.get("genre"):
        lines.append(f"Genre: {t['genre']}")
    if t.get("label"):
        lines.append(f"Label: {t['label']}")
    if t.get("country"):
        lines.append(f"Country: {t['country']}")
    if t.get("year"):
        lines.append(f"Year: {t['year']}")
    return "\n".join(lines)


def _parse(text: str) -> dict | None:
    """Defensive JSON parse: strip fences / chatty wrappers, validate types."""
    s = text.strip()
    s = re.sub(r"^```(?:json)?|```$", "", s.strip(), flags=re.MULTILINE).strip()
    m = re.search(r"\{.*\}", s, re.DOTALL)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    energy = d.get("energy")
    if not isinstance(energy, int) or not (1 <= energy <= 10):
        try:
            energy = max(1, min(10, int(round(float(energy)))))
        except (ValueError, TypeError):
            return None
    mood = d.get("mood") or []
    if not isinstance(mood, list):
        mood = [str(mood)]
    mood = [str(m).lower().strip() for m in mood if str(m).strip()][:4]
    conf = d.get("confidence")
    try:
        conf = max(0.0, min(1.0, float(conf)))
    except (ValueError, TypeError):
        conf = 0.5
    return {
        "energy": energy,
        "mood": mood,
        "scene": (str(d.get("scene")).strip() if d.get("scene") else None),
        "era": (str(d.get("era")).strip() if d.get("era") else None),
        "confidence": conf,
    }


def _tag_one(client: Any, track: dict) -> dict:
    """API-only (no DB). Returns {track_id, tags|None, in, out, error}."""
    in_tok = out_tok = 0
    for attempt in range(2):
        try:
            sys_prompt = SYSTEM if attempt == 0 else SYSTEM + "\nReturn ONLY the JSON object."
            resp = client.messages.create(
                model=settings.anthropic_model,
                max_tokens=400,
                system=sys_prompt,
                messages=[{"role": "user", "content": _user_text(track)}],
            )
            in_tok += resp.usage.input_tokens
            out_tok += resp.usage.output_tokens
            parsed = _parse(resp.content[0].text)
            if parsed:
                return {"track_id": track["id"], "tags": parsed, "in": in_tok, "out": out_tok, "error": None}
        except anthropic.APIError as e:
            return {"track_id": track["id"], "tags": None, "in": in_tok, "out": out_tok, "error": str(e)}
    return {"track_id": track["id"], "tags": None, "in": in_tok, "out": out_tok, "error": "unparseable JSON"}


def run(limit: int = 200) -> None:
    settings.require("db_url", "anthropic_api_key")
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    started = time.time()
    done = failed = 0
    tot_in = tot_out = 0
    with connect() as conn:
        reset_stale_jobs(conn, 15)
        jobs = claim_jobs(conn, SOURCE, limit)
        log.info("claimed %d claude jobs", len(jobs))
        job_by_track = {j["track_id"]: j for j in jobs}

        tracks = fetchall(
            conn,
            """
            select t.id, t.title, t.artist_name, t.album_title, t.genre,
                   extract(year from t.release_date)::int as year,
                   l.name as label, a.origin_country as country
              from tracks t
              left join releases r on r.id = t.album_id
              left join labels   l on l.id = r.label_id
              left join artists  a on a.id = t.primary_artist_id
             where t.id = any(%s)
            """,
            [[j["track_id"] for j in jobs]],
        )

        # parallelize ONLY the API calls; do all DB writes in this thread
        results: list[dict] = []
        if tracks:
            with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
                results = list(pool.map(lambda t: _tag_one(client, t), tracks))

        for res in results:
            tot_in += res["in"]
            tot_out += res["out"]
            job = job_by_track.get(res["track_id"])
            if not job:
                continue
            if not res["tags"]:
                finish_job(conn, job["id"], "retry", error=res["error"], attempts=job["attempts"])
                failed += 1
                continue
            tg = res["tags"]
            execute(
                conn,
                "update tracks set energy=%s, mood=%s, enrichment_status='claude', updated_at=now() where id=%s",
                [tg["energy"], tg["mood"], res["track_id"]],
            )
            tag_rows = []
            for dim in ("scene", "era"):
                if tg[dim]:
                    tag_rows.append(
                        {"entity_type": "track", "entity_id": res["track_id"], "tag": dim,
                         "value": tg[dim], "source": SOURCE, "confidence": tg["confidence"]}
                    )
            if tag_rows:
                upsert(
                    conn,
                    "tags",
                    tag_rows,
                    conflict_target="entity_type, entity_id, tag, coalesce(value,''), source",
                    update_cols=["confidence"],
                )
            conn.commit()
            finish_job(conn, job["id"], "done")
            done += 1

    log.info(
        "claude done: tagged=%d failed=%d | tokens in=%d out=%d | %.1fs",
        done, failed, tot_in, tot_out, time.time() - started,
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=200)
    run(ap.parse_args().limit)
