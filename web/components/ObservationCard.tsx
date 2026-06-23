"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Observation } from "@/lib/types";
import { Skeleton } from "./Skeleton";

// One sentence, ember-accented, with a subtle affordance to tap into the data it
// references. One observation — never a feed.
function hrefFor(o: Observation): string | null {
  const p = (o.payload ?? {}) as Record<string, unknown>;
  if (p.view === "orphans") return "/?view=orphans";
  if (p.artist_id) return `/artist/${p.artist_id}`;
  const f = (p.filter ?? {}) as Record<string, unknown>;
  if (f.country) return `/?country=${encodeURIComponent(String(f.country))}`;
  if (f.decade) return `/?decade=${f.decade}`;
  if (f.sort === "energy") return "/?sort=energy";
  return null;
}

export function ObservationCard() {
  const [obs, setObs] = useState<Observation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetch("/api/observation")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setObs(d))
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  if (loading) return <Skeleton className="h-16 w-full" />;
  if (!obs) return null;

  const href = hrefFor(obs);
  const inner = (
    <div className="group flex items-start gap-3">
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-ember" aria-hidden />
      <div>
        <div className="text-xs uppercase tracking-widest text-faint">Today</div>
        <p className="mt-1 font-serif text-lg leading-snug text-bone">
          {obs.body}
          {href && (
            <span className="ml-1 text-ember opacity-0 transition-opacity duration-200 ease-quiet group-hover:opacity-100">
              →
            </span>
          )}
        </p>
      </div>
    </div>
  );

  return (
    <section className="rounded-lg border border-hairline bg-surface px-4 py-4">
      {href ? (
        <Link href={href} prefetch>
          {inner}
        </Link>
      ) : (
        inner
      )}
    </section>
  );
}
