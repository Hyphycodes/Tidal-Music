// Defense-in-depth on top of the read-only role: validate/normalize generated SQL
// before it ever reaches the database. A single SELECT/WITH…SELECT only.

export type GuardResult = { ok: true; sql: string } | { ok: false; error: string };

// DML/DDL and session-mutating keywords. (The read-only role also blocks writes;
// this catches them earlier and rejects multi-statement / injection attempts.)
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|merge|call|copy|vacuum|reindex|comment|do|set|into|lock|listen|notify|prepare|execute)\b/i;

export function extractSql(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  return s.trim();
}

export function guardSql(raw: string): GuardResult {
  let s = extractSql(raw);
  // strip a single trailing semicolon; any remaining semicolon = multiple statements
  s = s.replace(/;\s*$/, "").trim();
  if (!s) return { ok: false, error: "empty query" };
  if (s.includes(";")) return { ok: false, error: "multiple statements are not allowed" };
  if (!/^\s*(with|select)\b/i.test(s)) return { ok: false, error: "only SELECT / WITH…SELECT is allowed" };
  if (FORBIDDEN.test(s)) return { ok: false, error: "query contains a forbidden keyword" };
  // enforce a hard row cap
  if (!/\blimit\b/i.test(s)) s = `${s} limit 500`;
  return { ok: true, sql: s };
}
