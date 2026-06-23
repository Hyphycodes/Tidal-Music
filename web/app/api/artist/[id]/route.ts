// GET /api/artist/[id] — artist record + their tracks + The Web + liner note.
import { getArtistDetail } from "@/lib/queries";
import { cachedJson, errorJson } from "@/lib/http";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const artist = await getArtistDetail(params.id);
    if (!artist) return errorJson("artist not found", 404);
    return cachedJson(artist);
  } catch {
    return errorJson("artist query failed", 500);
  }
}
