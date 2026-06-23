"""Track embeddings — feeds "sounds adjacent" recommendations (Digger).

    python -m pipeline.embed [--limit N]

Builds a short text descriptor per track (artist, genre, scene, mood, era,
country) and embeds it with a CPU-only ONNX model (BAAI/bge-large-en-v1.5,
1024-dim — matches vector(1024) in the schema). One embed per track, stored
forever; the read path never recomputes.
"""
from __future__ import annotations

import argparse
import time

from .config import configure_logging, settings
from .db import connect, execute, fetchall

log = configure_logging()


def _descriptor(t: dict) -> str:
    parts = [
        t.get("artist_name"),
        t.get("genre"),
        t.get("scene"),
        t.get("era"),
        t.get("country"),
        " ".join(t.get("mood") or []),
    ]
    return " ".join(p for p in parts if p) or (t.get("artist_name") or "music")


def run(limit: int = 500) -> None:
    settings.require("db_url")
    from fastembed import TextEmbedding  # heavy import — only when embedding

    with connect() as conn:
        tracks = fetchall(
            conn,
            """
            select t.id, t.artist_name, t.genre, t.mood,
                   a.origin_country as country,
                   (select value from tags where entity_type='track' and entity_id=t.id
                      and tag='scene' and source='claude' limit 1) as scene,
                   (select value from tags where entity_type='track' and entity_id=t.id
                      and tag='era' and source='claude' limit 1) as era
              from tracks t
              left join artists a on a.id = t.primary_artist_id
             where not exists (select 1 from track_embeddings e where e.track_id = t.id)
             order by t.saved_at desc nulls last
             limit %s
            """,
            [limit],
        )
        if not tracks:
            log.info("embed: nothing to do (all tracks embedded)")
            return

        log.info("embed: loading model %s …", settings.embed_model)
        model = TextEmbedding(model_name=settings.embed_model)
        texts = [_descriptor(t) for t in tracks]
        vectors = list(model.embed(texts))  # generator → list of np arrays (1024,)

        for t, vec in zip(tracks, vectors):
            v = vec.tolist() if hasattr(vec, "tolist") else list(vec)
            if len(v) != settings.embed_dim:
                log.warning("embedding dim %d != %d for track %s — skipping", len(v), settings.embed_dim, t["id"])
                continue
            literal = "[" + ",".join(f"{x:.6f}" for x in v) + "]"
            execute(
                conn,
                """
                insert into track_embeddings (track_id, embedding, model)
                values (%s, %s::vector, %s)
                on conflict (track_id) do update set
                  embedding = excluded.embedding, model = excluded.model, updated_at = now()
                """,
                [t["id"], literal, settings.embed_model],
            )
        log.info("embed: wrote %d embeddings", len(tracks))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=500)
    run(ap.parse_args().limit)
