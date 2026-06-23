import type { Credit } from "@/lib/types";

// Verified personnel from Discogs, grouped by role. The source is shown subtly —
// these are facts, not inference.
export function Credits({ credits }: { credits: Credit[] }) {
  if (!credits.length) return <p className="text-sm text-faint">No credits resolved.</p>;

  const groups = new Map<string, Credit[]>();
  for (const c of credits) {
    const arr = groups.get(c.role) ?? [];
    arr.push(c);
    groups.set(c.role, arr);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {[...groups.entries()].map(([role, people]) => (
        <div key={role} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-faint">{role}</span>
          <span className="text-sm text-bone">{people.map((p) => p.name).join(", ")}</span>
        </div>
      ))}
      <p className="mt-1 text-xs text-faint">verified · discogs</p>
    </div>
  );
}
