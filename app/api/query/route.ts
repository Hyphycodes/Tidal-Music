// POST /api/query — natural-language → read-only SQL → answer (the chat backbone).
//
// Flow (one Claude call for SQL + one SQL execution + one streamed Claude answer):
//   1. Claude translates the question to a single SELECT using ONLY the schema.
//   2. sql-guard rejects anything that isn't a single read-only SELECT; injects LIMIT.
//   3. Execute as the crate_readonly ROLE, inside a txn with statement_timeout=5s.
//   4. Stream a concise English answer derived from the rows.
// Safety: the guard AND the read-only role both block mutation. Streamed as NDJSON:
//   {type:"meta", sql, columns, rows, grounded}\n  then {type:"token", text}\n …  then {type:"done"}\n
import { NextRequest, NextResponse } from "next/server";
import { sqlRead } from "@/lib/db";
import { anthropic, MODEL } from "@/lib/anthropic";
import { SCHEMA_CONTEXT } from "@/lib/schema-context";
import { guardSql } from "@/lib/sql-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

async function generateSql(question: string, history: Turn[], feedback?: string): Promise<string> {
  const messages: Turn[] = [
    ...history.slice(-6),
    { role: "user", content: feedback ? `${question}\n\n(The previous attempt failed: ${feedback}. Return a corrected single SELECT.)` : question },
  ];
  const resp = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 600,
    system: `${SCHEMA_CONTEXT}\n\nReturn ONLY the SQL — a single SELECT or WITH…SELECT. No prose, no fences.`,
    messages,
  });
  const block = resp.content[0];
  return block && block.type === "text" ? block.text : "";
}

function friendly(error: string, sql?: string) {
  return NextResponse.json(
    {
      answer:
        "I couldn't turn that into a query I can run — try naming a field, a year, a genre, an artist, or a label.",
      rows: [],
      columns: [],
      sql: sql ?? "",
      grounded: false,
      error,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let question = "";
  let history: Turn[] = [];
  try {
    const body = await req.json();
    question = String(body.question ?? "").trim();
    if (Array.isArray(body.history)) history = body.history as Turn[];
  } catch {
    return friendly("invalid request body");
  }
  if (!question) return friendly("empty question");
  if (!process.env.ANTHROPIC_API_KEY) return friendly("server not configured (ANTHROPIC_API_KEY)");

  // 1–3: generate → guard → execute, with one automatic retry feeding back the error
  let lastErr = "";
  let safeSql = "";
  let rows: Record<string, unknown>[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let generated: string;
    try {
      generated = await generateSql(question, history, attempt === 0 ? undefined : lastErr);
    } catch {
      return friendly("the language model was unavailable");
    }
    const guard = guardSql(generated);
    if (!guard.ok) {
      lastErr = guard.error;
      continue;
    }
    safeSql = guard.sql;
    try {
      rows = (await sqlRead.begin(async (tx) => {
        await tx`set local statement_timeout = 5000`;
        return await tx.unsafe(safeSql);
      })) as unknown as Record<string, unknown>[];
      lastErr = "";
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "execution error";
    }
  }
  if (lastErr || !safeSql) return friendly(lastErr || "could not generate a query", safeSql);

  const columns = rows.length ? Object.keys(rows[0]!) : [];
  const capped = rows.slice(0, 50);

  // 4: stream the natural-language answer derived from the rows
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      send({ type: "meta", sql: safeSql, columns, rows, grounded: true });
      try {
        const s = anthropic().messages.stream({
          model: MODEL,
          max_tokens: 400,
          system:
            "You answer questions about the user's personal music library. Use ONLY the provided rows " +
            "(they came from the user's real data). Answer in 1-3 plain sentences. If there are no rows, " +
            "say there were no matches. Do NOT render a table — the UI shows the rows.",
          messages: [
            { role: "user", content: `Question: ${question}\n\nRows (JSON):\n${JSON.stringify(capped)}` },
          ],
        });
        for await (const ev of s) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            send({ type: "token", text: ev.delta.text });
          }
        }
      } catch {
        send({ type: "token", text: "(Here are the results.)" });
      }
      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
