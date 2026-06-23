// Opaque keyset cursors (base64 JSON). Keyset pagination only — never OFFSET.
export interface Cursor {
  v: string | number | null;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof c === "object" && c && "id" in c) return c as Cursor;
  } catch {
    /* malformed cursor → start from the top */
  }
  return null;
}
