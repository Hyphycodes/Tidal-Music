// GET /api/connections/[artistId] — relationship edges for one artist, strongest first.
import { sql } from "@/lib/db";
import { cachedJson, errorJson } from "@/lib/http";
import type { ConnectionEdge } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(_req: Request, { params }: { params: { artistId: string } }) {
  try {
    const edges = (await sql`
      select oa.id as artist_id, oa.name, r.kind, r.weight
        from relationships r
        join artists oa on oa.id = (case when r.artist_a = ${params.artistId} then r.artist_b else r.artist_a end)
       where r.artist_a = ${params.artistId} or r.artist_b = ${params.artistId}
       order by r.weight desc, oa.name asc
    `) as unknown as ConnectionEdge[];
    return cachedJson(edges);
  } catch {
    return errorJson("connections query failed", 500);
  }
}
