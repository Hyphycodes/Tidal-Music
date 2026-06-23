"use client";

import Link from "next/link";
import { useState } from "react";
import type { ListSummary } from "@/lib/types";
import { StatNumber } from "./StatNumber";
import { formatDate } from "@/lib/ui";

// All lists — cards with title, item count, last updated. Create inline (optimistic).
export function ListsIndex({ initial }: { initial: ListSummary[] }) {
  const [lists, setLists] = useState<ListSummary[]>(initial);
  const [title, setTitle] = useState("");

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    const r = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t }),
    });
    if (r.ok) {
      const created = (await r.json()) as ListSummary;
      setLists((prev) => [created, ...prev]);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-title text-bone">Lists</h1>
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="New list…"
            className="rounded border border-hairline bg-surface px-3 py-1.5 text-sm text-bone focus:border-ember focus:outline-none"
          />
          <button onClick={create} className="rounded bg-ember px-3 py-1.5 text-sm font-medium text-base">
            Create
          </button>
        </div>
      </div>

      {lists.length === 0 ? (
        <p className="text-sand">No lists yet. Create one, then add tracks from any track’s page.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {lists.map((l) => (
            <li key={l.id}>
              <Link
                href={`/lists/${l.id}`}
                prefetch={false}
                className="block rounded-lg border border-hairline bg-surface p-4 transition-colors duration-150 ease-quiet hover:border-ember"
              >
                <div className="font-serif text-lg text-bone">{l.title}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-faint">
                  <StatNumber>{l.item_count} tracks</StatNumber>
                  <span>updated {formatDate(l.updated_at)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
