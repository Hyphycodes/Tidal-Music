"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// Filters + sort. State lives in the URL (shareable, back-button safe). Text
// search is debounced. Maps directly to /api/library query params.
const SELECT = "bg-surface border border-hairline rounded px-2 py-1.5 text-sm text-bone";
const INPUT = `${SELECT} w-20`;

export function FilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const first = useRef(true);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.replace(`/?${next.toString()}`, { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => update({ q: q || null }), 300);
    return () => clearTimeout(id);
  }, [q, update]);

  const get = (k: string) => params.get(k) ?? "";
  const decades = ["", "1960", "1970", "1980", "1990", "2000", "2010", "2020"];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or artist…"
          className={`${SELECT} min-w-0 flex-1`}
          aria-label="Search"
        />
        <select value={get("sort")} onChange={(e) => update({ sort: e.target.value || null })} className={SELECT} aria-label="Sort">
          <option value="">Recently saved</option>
          <option value="energy">Energy</option>
          <option value="artist">Artist</option>
          <option value="release_date">Release date</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-sand">
        <input
          defaultValue={get("genre")}
          onBlur={(e) => update({ genre: e.target.value || null })}
          placeholder="Genre"
          className={`${SELECT} w-28`}
          aria-label="Genre"
        />
        <input
          defaultValue={get("country")}
          onBlur={(e) => update({ country: e.target.value || null })}
          placeholder="Country"
          className={`${SELECT} w-28`}
          aria-label="Country"
        />
        <select value={get("decade")} onChange={(e) => update({ decade: e.target.value || null })} className={SELECT} aria-label="Decade">
          {decades.map((d) => (
            <option key={d} value={d}>
              {d ? `${d}s` : "Any decade"}
            </option>
          ))}
        </select>
        <span className="flex items-center gap-1">
          <input defaultValue={get("energy_min")} onBlur={(e) => update({ energy_min: e.target.value || null })} placeholder="E min" className={INPUT} aria-label="Energy min" />
          <input defaultValue={get("energy_max")} onBlur={(e) => update({ energy_max: e.target.value || null })} placeholder="E max" className={INPUT} aria-label="Energy max" />
        </span>
        <span className="flex items-center gap-1">
          <input defaultValue={get("bpm_min")} onBlur={(e) => update({ bpm_min: e.target.value || null })} placeholder="BPM ≥" className={INPUT} aria-label="BPM min" />
          <input defaultValue={get("bpm_max")} onBlur={(e) => update({ bpm_max: e.target.value || null })} placeholder="BPM ≤" className={INPUT} aria-label="BPM max" />
        </span>
        <select value={get("in_list")} onChange={(e) => update({ in_list: e.target.value || null })} className={SELECT} aria-label="In a list">
          <option value="">Any list state</option>
          <option value="true">In a list</option>
          <option value="false">Not in a list</option>
        </select>
      </div>
    </div>
  );
}
