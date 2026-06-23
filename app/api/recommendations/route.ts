// GET /api/recommendations — the Digger surface. Mostly reads; one vector query.
//   (a) "sounds adjacent" — embedding nearest-neighbors to your most recent save
//   (b) label gaps — labels you're invested in (≥2 releases), go deeper
//   (c) under-explored long-followed artists
import { sql } from "@/lib/db";
import { cachedJson, errorJson } from "@/lib/http";
import type { Recommendation } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  try {
    const [adjacent, labels, artists] = await Promise.all([
      sql`
        with seed as (
          select e.track_id, e.embedding, t.primary_artist_id
            from track_embeddings e join tracks t on t.id = e.track_id
           order by t.saved_at desc nulls last
           limit 1
        )
        select t.id as track_id, t.title, t.artist_name
          from track_embeddings e
          join tracks t on t.id = e.track_id
          cross join seed
         where t.id <> seed.track_id
           and t.primary_artist_id is distinct from seed.primary_artist_id
         order by e.embedding <=> seed.embedding asc
         limit 8
      `,
      sql`select label_id, name, track_count from mv_label_counts where track_count >= 2 order by track_count desc limit 5`,
      sql`
        select a.id, a.name, count(t.id) c
          from artists a join tracks t on t.primary_artist_id = a.id
         where t.saved_at is not null
         group by a.id, a.name
        having count(t.id) between 1 and 2 and (max(t.saved_at) - min(t.saved_at)) > interval '180 days'
         order by (max(t.saved_at) - min(t.saved_at)) desc
         limit 5
      `,
    ]);

    const recs: Recommendation[] = [];
    for (const r of adjacent as unknown as { track_id: string; title: string; artist_name: string }[]) {
      recs.push({ kind: "adjacent", reason: "sounds adjacent to what you've been saving", track_id: r.track_id, title: r.title, artist_name: r.artist_name });
    }
    for (const r of labels as unknown as { label_id: string; name: string; track_count: number }[]) {
      recs.push({ kind: "label_gap", reason: `you have ${r.track_count} releases on ${r.name} — dig deeper`, label: r.name });
    }
    for (const r of artists as unknown as { id: string; name: string; c: number }[]) {
      recs.push({ kind: "under_explored", reason: `you've followed ${r.name} a while but saved only ${r.c}`, artist_id: r.id, artist_name: r.name });
    }
    return cachedJson(recs);
  } catch {
    return errorJson("recommendations query failed", 500);
  }
}
