"use client";

import Link from "next/link";

// Renders rows/columns from a query. Rows that are tracks/artists link to Detail —
// a question becomes a doorway into the data. Caps the DOM for large results.
function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v);
}

function cellText(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ResultTable({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  if (!rows?.length) return null;
  const cols = columns?.length ? columns : Object.keys(rows[0]!);
  const linkKind: "track" | "artist" | null =
    cols.includes("id") && cols.includes("title") ? "track" : cols.includes("id") && cols.includes("name") ? "artist" : null;
  const labelCol = linkKind === "track" ? "title" : linkKind === "artist" ? "name" : null;
  const shown = rows.slice(0, 100);

  return (
    <div className="mt-3 overflow-auto rounded-lg border border-hairline" style={{ maxHeight: 384 }}>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-raised">
          <tr>
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 text-left text-xs uppercase tracking-wide text-faint">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="border-t border-hairline">
              {cols.map((c) => {
                const v = r[c];
                const isNum = typeof v === "number";
                if (labelCol && c === labelCol && isUuid(r.id)) {
                  return (
                    <td key={c} className="px-3 py-2">
                      <Link href={`/${linkKind}/${r.id}`} prefetch={false} className="text-bone hover:text-ember">
                        {cellText(v)}
                      </Link>
                    </td>
                  );
                }
                return (
                  <td key={c} className={`px-3 py-2 ${isNum ? "font-mono tabular-nums text-sand" : "text-bone/90"}`}>
                    {cellText(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="px-3 py-2 text-xs text-faint">+{rows.length - shown.length} more rows</p>
      )}
    </div>
  );
}
