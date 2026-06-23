// POST /api/sync — on-demand delta sync.
//
// The Python pipeline cannot run inside Vercel (long-running + rate-limited), so
// this endpoint HONESTLY triggers the nightly GitHub Actions workflow via a
// repository_dispatch. It never runs enrichment inline. Protected by a shared
// secret header (x-sync-secret).
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret || req.headers.get("x-sync-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO; // e.g. "Hyphycodes/Tidal-Music"
  if (!token || !repo) {
    return NextResponse.json(
      { error: "sync not configured (GITHUB_DISPATCH_TOKEN / GITHUB_REPO)" },
      { status: 500 },
    );
  }

  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ event_type: "sync" }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: "failed to trigger workflow", status: res.status, detail: detail.slice(0, 200) },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, triggered: "github-actions:nightly-pipeline" });
}
