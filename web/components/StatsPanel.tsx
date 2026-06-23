"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Stats } from "@/lib/types";
import { StatNumber } from "./StatNumber";
import { Skeleton } from "./Skeleton";
import { formatMonth } from "@/lib/ui";

// Atlas — read straight from materialized views. Each row links into the
// corresponding filtered Library view where one exists.
function Ranked({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; count: number; href?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="rounded-lg border border-hairline bg-surface p-4">
      <h3 className="mb-3 text-xs uppercase tracking-widest text-faint">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-faint">No data yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.slice(0, 12).map((r, i) => {
            const inner = (
              <div className="relative flex items-center justify-between gap-3 rounded px-2 py-1">
                <span
                  className="absolute inset-y-0 left-0 rounded bg-ember/10"
                  style={{ width: `${(r.count / max) * 100}%` }}
                  aria-hidden
                />
                <span className="relative z-10 truncate text-sm text-bone">{r.label}</span>
                <StatNumber className="relative z-10 text-xs text-sand">{r.count}</StatNumber>
              </div>
            );
            return (
              <li key={i}>{r.href ? <Link href={r.href} prefetch={false} className="block hover:opacity-90">{inner}</Link> : inner}</li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    fetch("/api/stats").then((r) => (r.ok ? r.json() : null)).then(setStats).catch(() => {});
  }, []);

  if (!stats) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  const tlMax = Math.max(1, ...stats.timeline.map((t) => t.track_count));
  const presented = stats.playlist_presence.find((p) => p.in_playlist)?.track_count ?? 0;
  const uncurated = stats.playlist_presence.find((p) => !p.in_playlist)?.track_count ?? 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Ranked title="Top artists" rows={stats.top_artists.map((a) => ({ label: a.name, count: a.track_count, href: `/artist/${a.artist_id}` }))} />
      <Ranked title="Top producers" rows={stats.top_producers.map((p) => ({ label: p.name, count: p.track_count }))} />
      <Ranked title="Top labels" rows={stats.top_labels.map((l) => ({ label: l.name, count: l.track_count }))} />
      <Ranked title="Genres" rows={stats.genres.map((g) => ({ label: g.genre, count: g.track_count, href: `/?genre=${encodeURIComponent(g.genre)}` }))} />
      <Ranked title="Countries" rows={stats.countries.map((c) => ({ label: c.country, count: c.track_count, href: `/?country=${encodeURIComponent(c.country)}` }))} />
      <Ranked title="Decades" rows={stats.decades.map((d) => ({ label: `${d.decade}s`, count: d.track_count, href: `/?decade=${d.decade}` }))} />

      {/* save timeline — a small, restrained bar chart */}
      <section className="rounded-lg border border-hairline bg-surface p-4 sm:col-span-2">
        <h3 className="mb-3 text-xs uppercase tracking-widest text-faint">Saves by month</h3>
        {stats.timeline.length === 0 ? (
          <p className="text-sm text-faint">No data yet.</p>
        ) : (
          <div className="flex h-24 items-end gap-0.5 overflow-x-auto">
            {stats.timeline.map((t) => (
              <div
                key={t.month}
                className="w-2 shrink-0 rounded-t bg-ember/60"
                style={{ height: `${(t.track_count / tlMax) * 100}%` }}
                title={`${formatMonth(t.month)}: ${t.track_count}`}
              />
            ))}
          </div>
        )}
      </section>

      {/* uncurated vs presented self */}
      <section className="rounded-lg border border-hairline bg-surface p-4 sm:col-span-2">
        <h3 className="mb-3 text-xs uppercase tracking-widest text-faint">Uncurated vs presented self</h3>
        <div className="flex gap-8">
          <div>
            <StatNumber className="text-2xl text-bone">{presented}</StatNumber>
            <div className="text-sm text-sand">in a playlist</div>
          </div>
          <div>
            <StatNumber className="text-2xl text-bone">{uncurated}</StatNumber>
            <div className="text-sm text-sand">never playlisted</div>
          </div>
        </div>
      </section>
    </div>
  );
}
