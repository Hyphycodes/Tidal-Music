// GET (one list + items) / PATCH (rename, notes) / DELETE a list.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { getListDetail } from "@/lib/queries";
import { noStoreJson, errorJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const list = await getListDetail(params.id);
    if (!list) return errorJson("list not found", 404);
    return noStoreJson(list);
  } catch {
    return errorJson("could not load list", 500);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const rows = await sql`
      update lists set
        title = coalesce(${body.title ?? null}, title),
        kind  = coalesce(${body.kind ?? null}, kind),
        notes = ${body.notes === undefined ? sql`notes` : (body.notes ?? null)},
        updated_at = now()
      where id = ${params.id}
      returning id, title, kind, notes, updated_at
    `;
    if (!rows.length) return errorJson("list not found", 404);
    return noStoreJson(rows[0]);
  } catch {
    return errorJson("could not update list", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await sql`delete from lists where id = ${params.id}`;
    return noStoreJson({ ok: true });
  } catch {
    return errorJson("could not delete list", 500);
  }
}
