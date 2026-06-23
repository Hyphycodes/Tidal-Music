// POST add a track to a list.  PATCH batch-reorder (one statement, not one row per step).
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { noStoreJson, errorJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const trackId = String(body.track_id ?? "");
    if (!trackId) return errorJson("track_id is required", 400);

    const list = await sql`select 1 from lists where id = ${params.id}`;
    if (!list.length) return errorJson("list not found", 404);
    const track = await sql`select 1 from tracks where id = ${trackId}`;
    if (!track.length) return errorJson("track not found", 404);

    const rows = await sql`
      insert into list_items (list_id, track_id, rank)
      values (${params.id}, ${trackId},
              (select coalesce(max(rank), 0) + 1 from list_items where list_id = ${params.id}))
      on conflict (list_id, track_id) do nothing
      returning id, rank, note, rating
    `;
    await sql`update lists set updated_at = now() where id = ${params.id}`;
    return noStoreJson(rows[0] ?? { duplicate: true }, 201);
  } catch {
    return errorJson("could not add item", 500);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const order: string[] = Array.isArray(body.order) ? body.order.map(String) : [];
    if (!order.length) return errorJson("order array is required", 400);
    const ranks = order.map((_, i) => i + 1);
    await sql`
      update list_items li set rank = data.rk, updated_at = now()
      from (select unnest(${order}::uuid[]) as id, unnest(${ranks}::int[]) as rk) data
      where li.id = data.id and li.list_id = ${params.id}
    `;
    await sql`update lists set updated_at = now() where id = ${params.id}`;
    return noStoreJson({ ok: true });
  } catch {
    return errorJson("could not reorder items", 500);
  }
}
