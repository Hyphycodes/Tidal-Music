// GET /api/observation — today's single observation (most recent row). Instant.
import { sql } from "@/lib/db";
import { cachedJson, errorJson } from "@/lib/http";
import type { Observation } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  try {
    const rows = (await sql`
      select id, body, kind, payload, created_at
        from observations
       order by created_at desc
       limit 1
    `) as unknown as Observation[];
    return cachedJson(rows[0] ?? null);
  } catch {
    return errorJson("observation query failed", 500);
  }
}
