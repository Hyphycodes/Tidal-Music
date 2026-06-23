// GET /api/lists — all lists (with item counts).  POST /api/lists — create.
// Writes use the full-privilege server client (never the read-only role); the
// connection string is server-only and never reaches the client.
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { getLists } from "@/lib/queries";
import { noStoreJson, errorJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return noStoreJson(await getLists());
  } catch {
    return errorJson("could not load lists", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title = String(body.title ?? "").trim();
    if (!title) return errorJson("title is required", 400);
    const kind = body.kind ? String(body.kind) : null;
    const notes = body.notes ? String(body.notes) : null;
    const rows = await sql`
      insert into lists (title, kind, notes) values (${title}, ${kind}, ${notes})
      returning id, title, kind, notes, updated_at
    `;
    return noStoreJson({ ...rows[0], item_count: 0 }, 201);
  } catch {
    return errorJson("could not create list", 500);
  }
}
