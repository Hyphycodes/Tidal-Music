"use client";

import { useState } from "react";
import type { ListSummary } from "@/lib/types";

// "Add to list" from a track row / Detail: pick an existing list or create one
// inline. Stores only track_id + annotations — all display data joins at read.
export function AddToList({ trackId }: { trackId: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !lists) {
      const r = await fetch("/api/lists");
      setLists(r.ok ? await r.json() : []);
    }
  };

  const add = async (listId: string, label: string) => {
    setStatus("Saving…");
    await fetch(`/api/lists/${listId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track_id: trackId }),
    });
    setStatus(`Saved to ${label}`);
    setOpen(false);
  };

  const create = async () => {
    const t = newTitle.trim();
    if (!t) return;
    const r = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t }),
    });
    const l = await r.json();
    setNewTitle("");
    await add(l.id, l.title);
  };

  return (
    <div className="relative">
      <button onClick={toggle} className="text-sm text-sand hover:text-ember">
        {status ?? "+ Save to list"}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-60 rounded-lg border border-hairline bg-raised p-2 shadow-xl">
          <div className="max-h-48 overflow-auto">
            {lists === null ? (
              <p className="px-2 py-1 text-sm text-faint">Loading…</p>
            ) : lists.length === 0 ? (
              <p className="px-2 py-1 text-sm text-faint">No lists yet.</p>
            ) : (
              lists.map((l) => (
                <button
                  key={l.id}
                  onClick={() => add(l.id, l.title)}
                  className="block w-full truncate rounded px-2 py-1.5 text-left text-sm text-bone hover:bg-surface"
                >
                  {l.title}
                </button>
              ))
            )}
          </div>
          <div className="mt-2 flex gap-1 border-t border-hairline pt-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="New list…"
              className="min-w-0 flex-1 rounded border border-hairline bg-surface px-2 py-1 text-sm text-bone focus:outline-none"
            />
            <button onClick={create} className="rounded bg-ember px-2 py-1 text-sm text-base">
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
