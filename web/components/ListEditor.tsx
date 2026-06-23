"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ListDetail } from "@/lib/types";
import { RankableItems } from "./RankableItems";

// Editable title/notes + ranked items. Writes are optimistic (UI updates first).
export function ListEditor({ initial }: { initial: ListDetail }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);

  const save = (patch: Record<string, unknown>) =>
    fetch(`/api/lists/${initial.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});

  const del = async () => {
    if (!confirm("Delete this list?")) return;
    await fetch(`/api/lists/${initial.id}`, { method: "DELETE" });
    router.push("/lists");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => save({ title })}
          className="w-full bg-transparent font-serif text-title text-bone focus:outline-none"
          aria-label="List title"
        />
        <button onClick={del} className="shrink-0 text-sm text-faint hover:text-ember">
          Delete
        </button>
      </div>
      <textarea
        defaultValue={initial.notes ?? ""}
        onBlur={(e) => save({ notes: e.target.value })}
        placeholder="Notes…"
        rows={2}
        className="rounded border border-hairline bg-surface px-3 py-2 text-sm text-bone focus:border-ember focus:outline-none"
      />
      <RankableItems listId={initial.id} initial={initial.items} />
    </div>
  );
}
