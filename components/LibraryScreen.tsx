"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { FilterBar } from "./FilterBar";
import { TrackList } from "./TrackList";
import { StatsPanel } from "./StatsPanel";

const TABS = [
  { k: "", label: "Library" },
  { k: "stats", label: "Atlas" },
  { k: "orphans", label: "Orphans" },
];
const FILTER_KEYS = ["genre", "energy_min", "energy_max", "bpm_min", "bpm_max", "artist", "decade", "country", "in_list", "q", "sort"];

// One screen, one job: read and dig through the library. Tabs stay calm and
// uncluttered; filter state lives in the URL.
export function LibraryScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const view = params.get("view") ?? "";

  const libQuery = useMemo(() => {
    const sp = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) sp.set(k, v);
    }
    return sp.toString();
  }, [params]);

  const setView = (k: string) => {
    const sp = new URLSearchParams(window.location.search);
    if (k) sp.set("view", k);
    else sp.delete("view");
    router.replace(`/?${sp.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex gap-6 border-b border-hairline text-sm" aria-label="Library views">
        {TABS.map((t) => {
          const active = view === t.k;
          return (
            <button
              key={t.k || "library"}
              onClick={() => setView(t.k)}
              className={`-mb-px border-b-2 pb-2.5 transition-colors duration-150 ease-quiet ${
                active ? "border-ember text-bone" : "border-transparent text-sand hover:text-bone"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {view === "stats" ? (
        <StatsPanel />
      ) : view === "orphans" ? (
        <TrackList endpoint="/api/orphans" query="" />
      ) : (
        <>
          <FilterBar />
          <TrackList endpoint="/api/library" query={libQuery} />
        </>
      )}
    </div>
  );
}
