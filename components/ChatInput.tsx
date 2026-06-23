"use client";

import { useState } from "react";

// Single, calm input — the instrument. No HTML <form> (button + Enter handler).
export function ChatInput({ onSubmit, disabled }: { onSubmit: (q: string) => void; disabled?: boolean }) {
  const [v, setV] = useState("");
  const submit = () => {
    const q = v.trim();
    if (q && !disabled) {
      onSubmit(q);
      setV("");
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 focus-within:border-ember">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask your library anything…"
        aria-label="Ask your library"
        className="min-w-0 flex-1 bg-transparent text-bone placeholder:text-faint focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={disabled}
        className="rounded bg-ember px-3 py-1 text-sm font-medium text-base disabled:opacity-40"
      >
        Ask
      </button>
    </div>
  );
}
