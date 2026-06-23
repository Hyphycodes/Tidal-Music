"""Derive the artist relationship graph (The Web).

    python -m pipeline.derive_relationships

Three edge kinds, computed from the enriched data:
  * shared_producer — two artists share a producer/engineer (weight = #shared people)
  * same_label      — two artists appear on the same label (weight = #shared labels)
  * same_scene      — two artists share a Claude scene tag

Edges are normalized so a–b == b–a (always stored with artist_a < artist_b).
Full recompute each run (delete + rebuild) — clean and cheap while the library
is small (≲ a few thousand tracks). Cutover note: above that, switch to
recomputing only artists touched in the current run.
"""
from __future__ import annotations

import time

from .config import configure_logging
from .db import connect, execute, fetchall

log = configure_logging()

SHARED_PRODUCER = """
insert into relationships (artist_a, artist_b, kind, weight)
with ap as (
  select distinct t.primary_artist_id as artist_id, c.person_id
    from credits c join tracks t on t.id = c.track_id
   where c.role in ('producer', 'engineer') and t.primary_artist_id is not null
)
select a.artist_id, b.artist_id, 'shared_producer', count(distinct a.person_id)
  from ap a join ap b on a.person_id = b.person_id and a.artist_id < b.artist_id
 group by 1, 2
on conflict (artist_a, artist_b, kind) do update set weight = excluded.weight, updated_at = now()
"""

SAME_LABEL = """
insert into relationships (artist_a, artist_b, kind, weight)
with al as (
  select distinct t.primary_artist_id as artist_id, r.label_id
    from tracks t join releases r on r.id = t.album_id
   where t.primary_artist_id is not null and r.label_id is not null
)
select a.artist_id, b.artist_id, 'same_label', count(distinct a.label_id)
  from al a join al b on a.label_id = b.label_id and a.artist_id < b.artist_id
 group by 1, 2
on conflict (artist_a, artist_b, kind) do update set weight = excluded.weight, updated_at = now()
"""

SAME_SCENE = """
insert into relationships (artist_a, artist_b, kind, weight)
with sc as (
  select distinct t.primary_artist_id as artist_id, g.value as scene
    from tags g join tracks t on t.id = g.entity_id
   where g.entity_type = 'track' and g.tag = 'scene' and g.value is not null
     and t.primary_artist_id is not null
)
select a.artist_id, b.artist_id, 'same_scene', count(distinct a.scene)
  from sc a join sc b on a.scene = b.scene and a.artist_id < b.artist_id
 group by 1, 2
on conflict (artist_a, artist_b, kind) do update set weight = excluded.weight, updated_at = now()
"""


def run() -> None:
    started = time.time()
    with connect() as conn:
        execute(conn, "delete from relationships")  # fully derived → safe to rebuild
        execute(conn, SHARED_PRODUCER)
        execute(conn, SAME_LABEL)
        execute(conn, SAME_SCENE)
        counts = {r["kind"]: r["c"] for r in fetchall(conn, "select kind, count(*) c from relationships group by 1")}
    log.info("relationships rebuilt: %s in %.1fs", counts or "{}", time.time() - started)


if __name__ == "__main__":
    run()
