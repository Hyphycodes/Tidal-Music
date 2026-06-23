// GET /api/orphans — forgotten tracks (in no list), keyset-paginated like library.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { cachedJson, errorJson } from "@/lib/http";
import { encodeCursor, decodeCursor } from "@/lib/cursor";
import type { LibraryResponse, TrackRow } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(p.get("limit")) || 50, 1), 100);
  const cursor = decodeCursor(p.get("cursor"));

  let where = sql``;
  if (cursor) {
    where = sql`where (saved_at < ${cursor.v} or (saved_at = ${cursor.v} and id < ${cursor.id}))`;
  }

  try {
    const rows = (await sql`
      select id, title, artist_name, album_title, genre, energy, bpm, musical_key,
             saved_at, release_date, duration_sec
        from v_orphans
        ${where}
       order by saved_at desc nulls last, id desc
       limit ${limit}
    `) as unknown as TrackRow[];

    let nextCursor: string | null = null;
    if (rows.length === limit) {
      const last = rows[rows.length - 1]!;
      nextCursor = encodeCursor({ v: last.saved_at, id: last.id });
    }
    const body: LibraryResponse = { items: rows, nextCursor };
    return cachedJson(body);
  } catch {
    return errorJson("orphans query failed", 500);
  }
}
