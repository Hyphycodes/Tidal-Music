// GET /api/library — paginated, filtered, sorted track list.
// Keyset pagination (never OFFSET). Returns render-ready rows (no client joins).
// Budget: first warm page < 400ms (idx_tracks_saved_keyset on the default sort).
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { cachedJson, errorJson } from "@/lib/http";
import { encodeCursor, decodeCursor } from "@/lib/cursor";
import type { LibraryResponse, TrackRow } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 300;

type Sort = "saved_at" | "energy" | "artist" | "release_date";
const SORTS: ReadonlySet<string> = new Set(["saved_at", "energy", "artist", "release_date"]);

const COLUMNS = sql`
  id, title, artist_name, album_title, genre, energy, bpm, musical_key,
  saved_at, release_date, duration_sec`;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(p.get("limit")) || 50, 1), 100);
  const sort: Sort = (SORTS.has(p.get("sort") ?? "") ? p.get("sort") : "saved_at") as Sort;
  const cursor = decodeCursor(p.get("cursor"));

  // ── sort expression + direction (coalesce nullable sort keys for a total order) ──
  const order =
    sort === "energy"
      ? { expr: sql`coalesce(energy, -1)`, dir: "desc" as const }
      : sort === "artist"
        ? { expr: sql`lower(artist_name)`, dir: "asc" as const }
        : sort === "release_date"
          ? { expr: sql`coalesce(release_date, '0001-01-01')`, dir: "desc" as const }
          : { expr: sql`saved_at`, dir: "desc" as const };

  // ── filters ──
  const conds: ReturnType<typeof sql>[] = [];
  const genre = p.get("genre");
  if (genre) conds.push(sql`genre = ${genre}`);
  const emin = p.get("energy_min");
  if (emin) conds.push(sql`energy >= ${Number(emin)}`);
  const emax = p.get("energy_max");
  if (emax) conds.push(sql`energy <= ${Number(emax)}`);
  const bmin = p.get("bpm_min");
  if (bmin) conds.push(sql`bpm >= ${Number(bmin)}`);
  const bmax = p.get("bpm_max");
  if (bmax) conds.push(sql`bpm <= ${Number(bmax)}`);
  const artist = p.get("artist");
  if (artist) conds.push(sql`artist_name ilike ${"%" + artist + "%"}`);
  const decade = p.get("decade");
  if (decade && !Number.isNaN(Number(decade))) {
    const d = Number(decade);
    conds.push(sql`release_date >= ${`${d}-01-01`}::date and release_date < ${`${d + 10}-01-01`}::date`);
  }
  const country = p.get("country");
  if (country)
    conds.push(sql`exists (select 1 from artists a where a.id = tracks.primary_artist_id and a.origin_country = ${country})`);
  const inList = p.get("in_list");
  if (inList === "true") conds.push(sql`exists (select 1 from list_items li where li.track_id = tracks.id)`);
  if (inList === "false") conds.push(sql`not exists (select 1 from list_items li where li.track_id = tracks.id)`);
  const q = p.get("q");
  if (q) conds.push(sql`(title ilike ${"%" + q + "%"} or artist_name ilike ${"%" + q + "%"})`);

  // ── keyset predicate ──
  if (cursor) {
    const cmp = order.dir === "desc" ? sql`<` : sql`>`;
    conds.push(
      sql`(${order.expr} ${cmp} ${cursor.v} or (${order.expr} = ${cursor.v} and tracks.id < ${cursor.id}))`,
    );
  }

  let where = sql``;
  conds.forEach((c, i) => {
    where = i === 0 ? sql`where ${c}` : sql`${where} and ${c}`;
  });

  try {
    const dir = order.dir === "desc" ? sql`desc` : sql`asc`;
    const rows = (await sql`
      select ${COLUMNS} from tracks
      ${where}
      order by ${order.expr} ${dir}, tracks.id desc
      limit ${limit}
    `) as unknown as TrackRow[];

    let nextCursor: string | null = null;
    if (rows.length === limit) {
      const last = rows[rows.length - 1]!;
      const v =
        sort === "energy"
          ? last.energy ?? -1
          : sort === "artist"
            ? last.artist_name.toLowerCase()
            : sort === "release_date"
              ? last.release_date ?? "0001-01-01"
              : last.saved_at;
      nextCursor = encodeCursor({ v, id: last.id });
    }

    const body: LibraryResponse = { items: rows, nextCursor };
    return cachedJson(body);
  } catch {
    return errorJson("library query failed", 500);
  }
}
