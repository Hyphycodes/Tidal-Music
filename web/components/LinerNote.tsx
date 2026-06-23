import type { Narrative } from "@/lib/types";
import { InferenceBadge } from "./Tag";

// Rendered as liner notes, clearly labeled as Claude's interpretation grounded in
// the known facts (the fact/inference line is always visible).
export function LinerNote({ narrative }: { narrative: Narrative | null }) {
  if (!narrative?.body) return null;
  const paragraphs = narrative.body.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="max-w-reading">
      <InferenceBadge />
      <div className="mt-2 flex flex-col gap-3">
        {paragraphs.map((p, i) => (
          <p key={i} className="font-serif text-[1.05rem] leading-relaxed text-bone/90">
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}
