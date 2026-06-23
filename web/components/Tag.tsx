// The fact/inference primitive, reused by Detail and Chat so the distinction is
// consistent everywhere. Verified (solid, neutral) vs Claude-inferred (outlined,
// with a confidence dot whose opacity tracks confidence).
import type { Source } from "@/lib/types";

export function Tag({
  label,
  source,
  confidence,
}: {
  label: string;
  source?: Source | string | null;
  confidence?: number | null;
}) {
  const inferred = source === "claude";
  if (inferred) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-0.5 text-xs text-sand">
        <span
          className="h-1.5 w-1.5 rounded-full bg-ember"
          style={{ opacity: confidence ?? 0.6 }}
          title={confidence != null ? `inferred · ${(confidence * 100).toFixed(0)}% confidence` : "inferred"}
        />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-raised px-2.5 py-0.5 text-xs text-bone/90">
      {label}
    </span>
  );
}

/** Tiny inline marker used to label a whole block as Claude interpretation. */
export function InferenceBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-sand">
      <span className="h-1.5 w-1.5 rounded-full bg-ember" /> interpretation
    </span>
  );
}
