"use client";

import Link from "next/link";
import { useState } from "react";
import type { ListItem } from "@/lib/types";
import { energyColor } from "@/lib/ui";

// Drag to reorder (optimistic; one batched PATCH). Per-item note + rating inline.
// Each item links to track Detail.
function Stars({ value, onChange }: { value: number | null; onChange: (r: number) => void }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className="text-sm leading-none"
          style={{ color: (value ?? 0) >= n ? "var(--ember)" : "var(--faint)" }}
        >
          ●
        </button>
      ))}
    </span>
  );
}

export function RankableItems({ listId, initial }: { listId: string; initial: ListItem[] }) {
  const [items, setItems] = useState<ListItem[]>(initial);
  const [drag, setDrag] = useState<number | null>(null);

  const persistOrder = (next: ListItem[]) =>
    fetch(`/api/lists/${listId}/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((i) => i.item_id) }),
    }).catch(() => {});

  const onDrop = (target: number) => {
    if (drag === null || drag === target) return setDrag(null);
    const next = [...items];
    const [moved] = next.splice(drag, 1);
    if (moved) next.splice(target, 0, moved);
    setItems(next);
    setDrag(null);
    persistOrder(next);
  };

  const patchItem = (itemId: string, patch: Partial<ListItem>) => {
    setItems((prev) => prev.map((i) => (i.item_id === itemId ? { ...i, ...patch } : i)));
    fetch(`/api/lists/${listId}/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  };

  const remove = (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.item_id !== itemId));
    fetch(`/api/lists/${listId}/items/${itemId}`, { method: "DELETE" }).catch(() => {});
  };

  if (!items.length) return <p className="text-sm text-faint">No tracks yet — add some from a track’s page.</p>;

  return (
    <ol className="flex flex-col">
      {items.map((it, idx) => (
        <li
          key={it.item_id}
          draggable
          onDragStart={() => setDrag(idx)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(idx)}
          className="flex items-center gap-3 border-b border-hairline py-2.5"
        >
          <span className="w-5 shrink-0 cursor-grab font-mono text-xs text-faint" title="drag to reorder">
            {idx + 1}
          </span>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: energyColor(it.track.energy) }} />
          <span className="min-w-0 flex-1">
            <Link href={`/track/${it.track.id}`} prefetch={false} className="block truncate text-bone hover:text-ember">
              {it.track.title}
            </Link>
            <span className="block truncate text-xs text-sand">{it.track.artist_name}</span>
          </span>
          <input
            defaultValue={it.note ?? ""}
            onBlur={(e) => patchItem(it.item_id, { note: e.target.value || null })}
            placeholder="note…"
            className="hidden w-40 rounded border border-hairline bg-surface px-2 py-1 text-xs text-bone sm:block"
          />
          <Stars value={it.rating} onChange={(r) => patchItem(it.item_id, { rating: r })} />
          <button onClick={() => remove(it.item_id)} aria-label="remove" className="text-faint hover:text-ember">
            ×
          </button>
        </li>
      ))}
    </ol>
  );
}
