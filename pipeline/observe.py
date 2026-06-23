"""Observation engine — the one daily insight.

    python -m pipeline.observe

After each sync, compute candidates across several detectors, then write exactly
ONE true, specific observation (avoiding the last few kinds/subjects so it stays
interesting). Facts are computed in SQL/Python — never invented. The body is one
clean sentence; `payload` carries the numbers + a link hint for the UI.
"""
from __future__ import annotations

import json
import statistics
import time
from typing import Any

from .config import configure_logging
from .db import connect, execute, fetchall, fetchval

log = configure_logging()

Candidate = dict[str, Any]


def _months_between(days: float) -> int:
    return max(1, int(round(days / 30.0)))


# ── detectors: each returns a Candidate or None ─────────────────────────────
def d_orphans(conn: Any) -> Candidate | None:
    n = fetchval(conn, "select count(*) from v_orphans") or 0
    total = fetchval(conn, "select count(*) from tracks") or 0
    if total and n / total >= 0.2 and n >= 5:
        return {
            "kind": "orphans",
            "subject": "orphans",
            "body": f"You haven't placed {n} of your {total} tracks into any list since you saved them.",
            "payload": {"view": "orphans", "count": int(n)},
            "score": min(1.0, n / total) * 0.6,
        }
    return None


def d_energy_drift(conn: Any) -> Candidate | None:
    recent = [r["energy"] for r in fetchall(
        conn, "select energy from tracks where energy is not null order by saved_at desc limit 14"
    )]
    if len(recent) < 10:
        return None
    base = fetchval(conn, "select avg(energy)::float from tracks where energy is not null")
    if base is None:
        return None
    ra = statistics.mean(recent)
    if ra - base >= 1.5:
        return {"kind": "energy_drift", "subject": "energy_up",
                "body": f"Your last {len(recent)} saves average energy {ra:.1f} — well above your usual {base:.1f}. That's new.",
                "payload": {"recent_avg": round(ra, 1), "baseline": round(base, 1), "direction": "up", "filter": {"sort": "energy"}},
                "score": (ra - base) / 9 + 0.4}
    if base - ra >= 1.5:
        return {"kind": "energy_drift", "subject": "energy_down",
                "body": f"Your last {len(recent)} saves average energy {ra:.1f} — quieter than your usual {base:.1f}.",
                "payload": {"recent_avg": round(ra, 1), "baseline": round(base, 1), "direction": "down", "filter": {"sort": "energy"}},
                "score": (base - ra) / 9 + 0.4}
    return None


def d_producer(conn: Any) -> Candidate | None:
    rows = fetchall(
        conn,
        """select p.id, p.name, count(distinct c.track_id) tracks, count(distinct t.primary_artist_id) artists
             from credits c join people p on p.id=c.person_id join tracks t on t.id=c.track_id
            where c.role='producer'
            group by p.id, p.name
           having count(distinct c.track_id) >= 3
            order by tracks desc, artists desc limit 1""",
    )
    if not rows:
        return None
    r = rows[0]
    return {"kind": "hidden_connection", "subject": f"producer:{r['id']}",
            "body": f"{r['name']} is on {r['tracks']} of your saved tracks, across {r['artists']} different artists.",
            "payload": {"person_id": str(r["id"]), "tracks": r["tracks"], "artists": r["artists"]},
            "score": 0.5 + min(0.4, r["tracks"] / 20)}


def d_depth_gap(conn: Any) -> Candidate | None:
    rows = fetchall(
        conn,
        """select a.id, a.name, count(t.id) c,
                  extract(epoch from (max(t.saved_at)-min(t.saved_at)))/86400 as span_days
             from artists a join tracks t on t.primary_artist_id=a.id
            where t.saved_at is not null
            group by a.id, a.name
           having count(t.id) between 1 and 2
              and (max(t.saved_at)-min(t.saved_at)) > interval '180 days'
            order by span_days desc limit 1""",
    )
    if not rows:
        return None
    r = rows[0]
    months = _months_between(float(r["span_days"]))
    return {"kind": "depth_gap", "subject": f"depth:{r['id']}",
            "body": f"You've followed {r['name']} for {months} months but saved only {r['c']} of their tracks.",
            "payload": {"artist_id": str(r["id"]), "saved": r["c"], "months": months},
            "score": 0.45 + min(0.3, months / 60)}


def d_geography(conn: Any) -> Candidate | None:
    rows = fetchall(conn, "select country, track_count from mv_country_distribution order by track_count desc")
    total = sum(r["track_count"] for r in rows)
    if total < 5 or len(rows) < 2:
        return None
    top2 = rows[:2]
    pct = sum(r["track_count"] for r in top2) / total
    if pct >= 0.4:
        return {"kind": "geography", "subject": "geo:" + ",".join(r["country"] for r in top2),
                "body": f"{round(pct*100)}% of your library traces to {top2[0]['country']} and {top2[1]['country']}.",
                "payload": {"countries": [r["country"] for r in top2], "filter": {"country": top2[0]["country"]}},
                "score": 0.4 + (pct - 0.4)}
    return None


def d_decade(conn: Any) -> Candidate | None:
    rows = fetchall(conn, "select decade, track_count from mv_decade_distribution order by track_count desc")
    total = sum(r["track_count"] for r in rows)
    if total < 8 or not rows:
        return None
    top = rows[0]
    pct = top["track_count"] / total
    if pct >= 0.35 and top["decade"]:
        return {"kind": "temporal", "subject": f"decade:{top['decade']}",
                "body": f"You over-index on the {int(top['decade'])}s — {round(pct*100)}% of your dated saves.",
                "payload": {"decade": int(top["decade"]), "filter": {"decade": int(top["decade"])}},
                "score": 0.4 + (pct - 0.35)}
    return None


def d_timeline_peak(conn: Any) -> Candidate | None:
    rows = fetchall(conn, "select month, track_count from mv_save_timeline order by track_count desc limit 1")
    if not rows or rows[0]["track_count"] < 5:
        return None
    r = rows[0]
    m = r["month"]
    label = m.strftime("%B %Y") if hasattr(m, "strftime") else str(m)
    return {"kind": "timeline_peak", "subject": f"peak:{label}",
            "body": f"Your biggest month was {label}: {r['track_count']} tracks saved.",
            "payload": {"month": str(m), "count": r["track_count"]},
            "score": 0.35}


DETECTORS = [d_orphans, d_energy_drift, d_producer, d_depth_gap, d_geography, d_decade, d_timeline_peak]


def run() -> None:
    started = time.time()
    with connect() as conn:
        recent = fetchall(conn, "select kind, payload from observations order by created_at desc limit 3")
        recent_subjects = {
            (r["kind"], (r["payload"] or {}).get("subject")) for r in recent
        }
        recent_kinds = [r["kind"] for r in recent]

        candidates: list[Candidate] = []
        for det in DETECTORS:
            try:
                c = det(conn)
            except Exception as e:  # noqa: BLE001 — a detector with no data is skipped, never fatal
                log.warning("detector %s skipped: %s", det.__name__, e)
                c = None
            if c:
                candidates.append(c)

        if not candidates:
            log.info("observe: no candidate observations this run")
            return

        # anti-repetition: drop exact (kind, subject) repeats; penalize recent kinds
        def adjusted(c: Candidate) -> float:
            penalty = 0.25 * recent_kinds.count(c["kind"])
            return c["score"] - penalty

        fresh = [c for c in candidates if (c["kind"], c["subject"]) not in recent_subjects] or candidates
        best = max(fresh, key=adjusted)

        payload = dict(best["payload"])
        payload["subject"] = best["subject"]
        execute(
            conn,
            "insert into observations (body, kind, payload) values (%s, %s, %s::jsonb)",
            [best["body"], best["kind"], json.dumps(payload)],
        )
    log.info("observe: wrote 1 observation [%s] in %.1fs", best["kind"], time.time() - started)


if __name__ == "__main__":
    run()
