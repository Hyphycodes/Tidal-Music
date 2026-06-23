"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Recommendation } from "@/lib/types";
import { Skeleton } from "./Skeleton";

// Digger — forward-looking, ranked, with the reason shown. Loads after the core
// record (skeleton meanwhile); cached endpoint.
export function Recommendations() {
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  useEffect(() => {
    fetch("/api/recommendations").then((r) => (r.ok ? r.json() : [])).then(setRecs).catch(() => setRecs([]));
  }, []);

  if (!recs) return <Skeleton className="h-32 w-full" />;
  if (!recs.length) return <p className="text-sm text-faint">Nothing to dig into yet — enrich the library first.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {recs.map((r, i) => {
        const label =
          r.kind === "adjacent" ? `${r.title} · ${r.artist_name}` : r.kind === "under_explored" ? r.artist_name : r.label;
        const href = r.track_id ? `/track/${r.track_id}` : r.artist_id ? `/artist/${r.artist_id}` : null;
        const body = (
          <div className="flex flex-col rounded border border-hairline bg-surface px-3 py-2">
            <span className="text-sm text-bone">{label}</span>
            <span className="text-xs text-faint">{r.reason}</span>
          </div>
        );
        return <li key={i}>{href ? <Link href={href} prefetch={false}>{body}</Link> : body}</li>;
      })}
    </ul>
  );
}
