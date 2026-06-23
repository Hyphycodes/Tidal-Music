"use client";

import { useEffect, useRef, useState } from "react";
import { ChatInput } from "./ChatInput";
import { ResultTable } from "./ResultTable";

interface Msg {
  role: "user" | "assistant";
  content: string;
  rows?: Record<string, unknown>[];
  columns?: string[];
  sql?: string;
  grounded?: boolean;
  streaming?: boolean;
  error?: string;
}

const STARTERS = [
  "what have I been saving lately that isn't in a playlist",
  "producers on more than 3 of my tracks",
  "my saves by month in 2023",
  "labels in my 2023 saves",
];

export function ChatThread() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const patch = (i: number, p: Partial<Msg>) => setMsgs((prev) => prev.map((m, j) => (j === i ? { ...m, ...p } : m)));

  async function ask(question: string) {
    if (busy) return;
    const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    const assistantIdx = msgs.length + 1;
    setMsgs((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "", streaming: true }]);
    setBusy(true);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const d = await res.json();
        patch(assistantIdx, { content: d.answer, rows: d.rows, columns: d.columns, sql: d.sql, grounded: d.grounded, error: d.error, streaming: false });
      } else if (res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let answer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const ev = JSON.parse(line);
              if (ev.type === "meta") patch(assistantIdx, { rows: ev.rows, columns: ev.columns, sql: ev.sql, grounded: ev.grounded });
              else if (ev.type === "token") {
                answer += ev.text;
                patch(assistantIdx, { content: answer });
              } else if (ev.type === "done") patch(assistantIdx, { streaming: false });
            } catch {
              /* ignore partial line */
            }
          }
        }
        patch(assistantIdx, { streaming: false });
      }
    } catch (e) {
      patch(assistantIdx, { content: "Couldn't reach the query service.", streaming: false, error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col gap-4">
      <div className="flex-1">
        {msgs.length === 0 ? (
          <div className="flex flex-col gap-4 py-10">
            <p className="font-serif text-title text-bone">Ask your library.</p>
            <p className="max-w-reading text-sand">
              Plain-English questions, answered from your real data. It writes a read-only query, runs it, and explains the result.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-sm text-sand transition-colors duration-150 ease-quiet hover:border-ember hover:text-bone"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="self-end rounded-2xl rounded-br-sm bg-raised px-4 py-2 text-bone">
                  {m.content}
                </div>
              ) : (
                <Answer key={i} m={m} />
              ),
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="sticky bottom-4">
        <ChatInput onSubmit={ask} disabled={busy} />
      </div>
    </div>
  );
}

function Answer({ m }: { m: Msg }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {m.grounded ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-2 py-0.5 text-xs text-bone/80">
            <span className="h-1.5 w-1.5 rounded-full bg-ember" /> from your data
          </span>
        ) : m.error ? (
          <span className="text-xs text-faint">couldn’t query</span>
        ) : null}
      </div>
      <p className="text-bone">
        {m.content}
        {m.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-ember align-middle" />}
      </p>
      {m.rows && m.columns && <ResultTable columns={m.columns} rows={m.rows} />}
      {m.sql && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-faint hover:text-sand">show SQL</summary>
          <pre className="mt-1 overflow-auto rounded bg-surface p-3 text-xs text-sand">{m.sql}</pre>
        </details>
      )}
    </div>
  );
}
