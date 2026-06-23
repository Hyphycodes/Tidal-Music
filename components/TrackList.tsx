"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LibraryResponse, TrackRow } from "@/lib/types";
import { energyColor, formatDate, formatDuration } from "@/lib/ui";
import { StatNumber } from "./StatNumber";
import { SkeletonRows } from "./Skeleton";

const ROW = 56;
const VIEWPORT = 640;
const OVERSCAN = 6;

// Virtualized + keyset-paginated. Fixed-height rows → constant-time rendering
// regardless of library size. Reused for /api/library and /api/orphans.
export function TrackList({ endpoint, query }: { endpoint: string; query: string }) {
  const router = useRouter();
  const [items, setItems] = useState<TrackRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const reqId = useRef(0);

  // reset when the query (filters/sort) changes
  useEffect(() => {
    reqId.current += 1;
    setItems([]);
    setCursor(null);
    setDone(false);
    setScrollTop(0);
  }, [endpoint, query]);

  const load = useCallback(
    async (cur: string | null, mine: number) => {
      setLoading(true);
      try {
        const u = `${endpoint}?${query}${cur ? `&cursor=${encodeURIComponent(cur)}` : ""}`;
        const r = await fetch(u);
        const d: LibraryResponse = await r.json();
        if (mine !== reqId.current) return; // stale (filters changed) — drop
        setItems((prev) => [...prev, ...(d.items ?? [])]);
        setCursor(d.nextCursor);
        if (!d.nextCursor) setDone(true);
      } catch {
        if (mine === reqId.current) setDone(true);
      } finally {
        if (mine === reqId.current) setLoading(false);
      }
    },
    [endpoint, query],
  );

  // initial page
  useEffect(() => {
    if (items.length === 0 && !done && !loading) load(null, reqId.current);
  }, [items.length, done, loading, load]);

  const start = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const end = Math.min(items.length, Math.ceil((scrollTop + VIEWPORT) / ROW) + OVERSCAN);
  const visible = useMemo(() => items.slice(start, end), [items, start, end]);

  // load next page as we approach the tail
  useEffect(() => {
    if (!done && !loading && cursor && end > items.length - 12) load(cursor, reqId.current);
  }, [end, items.length, done, loading, cursor, load]);

  if (items.length === 0 && loading) return <SkeletonRows rows={10} />;
  if (items.length === 0 && done)
    return <p className="px-1 py-10 text-center text-sand">Nothing here yet.</p>;

  return (
    <div
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{ height: VIEWPORT, overflowY: "auto" }}
      className="-mx-1"
    >
      <div style={{ height: items.length * ROW, position: "relative" }}>
        {visible.map((t, i) => {
          const top = (start + i) * ROW;
          return (
            <div key={t.id} style={{ position: "absolute", top, left: 0, right: 0, height: ROW }}>
              <button
                onClick={() => router.push(`/track/${t.id}`)}
                onMouseEnter={() => router.prefetch(`/track/${t.id}`)}
                className="group flex h-full w-full items-center gap-4 border-b border-hairline px-1 text-left transition-colors duration-150 ease-quiet hover:bg-surface"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: energyColor(t.energy) }}
                  title={t.energy != null ? `energy ${t.energy}` : "energy unknown"}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-bone">{t.title}</span>
                  <span className="block truncate text-sm text-sand">
                    {t.artist_name}
                    {t.album_title ? ` · ${t.album_title}` : ""}
                  </span>
                </span>
                <span className="hidden w-20 shrink-0 truncate text-right text-xs text-faint sm:block">
                  {t.genre ?? ""}
                </span>
                <StatNumber className="hidden w-12 shrink-0 text-right text-xs text-sand sm:block">
                  {t.bpm ? Math.round(Number(t.bpm)) : "—"}
                </StatNumber>
                <StatNumber className="hidden w-10 shrink-0 text-right text-xs text-sand md:block">
                  {t.musical_key ?? "—"}
                </StatNumber>
                <StatNumber className="w-14 shrink-0 text-right text-xs text-faint">
                  {formatDuration(t.duration_sec)}
                </StatNumber>
                <StatNumber className="hidden w-24 shrink-0 text-right text-xs text-faint lg:block">
                  {formatDate(t.saved_at)}
                </StatNumber>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
