// Pooled Postgres clients (Supabase transaction pooler, port 6543).
//
// STACK NOTE / deviation from PROJECT_CONTEXT §4: we use `postgres` (porsager)
// rather than @supabase/supabase-js for DB access. The core surfaces require raw
// parameterized SQL that PostgREST/supabase-js cannot express cleanly — keyset
// tuple pagination, arbitrary generated SELECTs for /api/query, MV reads, and the
// dedicated read-only ROLE connection. `postgres` runs server-side only and is
// never shipped to the client. See web/PERF.md.
//
// `prepare: false` is required for the pgBouncer transaction pooler.
import postgres from "postgres";

const common = { prepare: false, idle_timeout: 20, connect_timeout: 10 } as const;

function make(url: string | undefined, max: number) {
  if (!url) {
    // Defer the error to request time (so the app still builds without env set).
    return postgres("postgres://invalid", { ...common, max });
  }
  return postgres(url, { ...common, max });
}

// Reuse across hot-reloads in dev so we don't exhaust pooler connections.
const g = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
  __sqlRead?: ReturnType<typeof postgres>;
};

/** Full-privilege server client (reads + the lists writes in §15). */
export const sql = g.__sql ?? make(process.env.SUPABASE_DB_URL, 5);

/** Read-only role client — backs /api/query (text-to-SQL). */
export const sqlRead = g.__sqlRead ?? make(process.env.SUPABASE_DB_URL_READONLY, 3);

if (process.env.NODE_ENV !== "production") {
  g.__sql = sql;
  g.__sqlRead = sqlRead;
}
