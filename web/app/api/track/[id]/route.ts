// GET /api/track/[id] — the COMPLETE enriched record in one query (no follow-ups).
// release + all artists + all credits + all tags (by source/confidence) + liner note.
// Budget: < 300ms (PK + idx_credits_track + idx_tags_entity).
import { getTrackDetail } from "@/lib/queries";
import { cachedJson, errorJson } from "@/lib/http";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const track = await getTrackDetail(params.id);
    if (!track) return errorJson("track not found", 404);
    return cachedJson(track);
  } catch {
    return errorJson("track query failed", 500);
  }
}
