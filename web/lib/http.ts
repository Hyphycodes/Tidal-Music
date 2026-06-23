import { NextResponse } from "next/server";

// Data changes once daily (after the nightly sync), so cache aggressively at the
// edge while serving stale instantly (speed doctrine §3.8).
export const READ_CACHE = "public, s-maxage=300, stale-while-revalidate=86400";

export function cachedJson(data: unknown, cache: string = READ_CACHE) {
  return NextResponse.json(data, { headers: { "Cache-Control": cache } });
}

export function noStoreJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorJson(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
