// PATCH one item (rank / note / rating).  DELETE one item.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { noStoreJson, errorJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const body = await req.json();
    const rating = body.rating;
    if (rating != null && (typeof rating !== "number" || rating < 1 || rating > 5)) {
      return errorJson("rating must be between 1 and 5", 400);
    }
    const rows = await sql`
      update list_items set
        rank   = coalesce(${body.rank ?? null}, rank),
        note   = ${body.note === undefined ? sql`note` : (body.note ?? null)},
        rating = coalesce(${rating ?? null}, rating),
        updated_at = now()
      where id = ${params.itemId} and list_id = ${params.id}
      returning id, rank, note, rating
    `;
    if (!rows.length) return errorJson("item not found", 404);
    await sql`update lists set updated_at = now() where id = ${params.id}`;
    return noStoreJson(rows[0]);
  } catch {
    return errorJson("could not update item", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string; itemId: string } }) {
  try {
    await sql`delete from list_items where id = ${params.itemId} and list_id = ${params.id}`;
    await sql`update lists set updated_at = now() where id = ${params.id}`;
    return noStoreJson({ ok: true });
  } catch {
    return errorJson("could not delete item", 500);
  }
}
