import Link from "next/link";
import type { ConnectionEdge } from "@/lib/types";
import { StatNumber } from "./StatNumber";

// The Web — "these artists are basically the same room." Grouped by kind,
// strongest first, each connected artist linkable.
const KIND_LABEL: Record<string, string> = {
  shared_producer: "Shared producer",
  same_label: "Same label",
  same_scene: "Same scene",
  same_session: "Same session",
};

export function Connections({ edges }: { edges: ConnectionEdge[] }) {
  if (!edges.length) return <p className="text-sm text-faint">No connections in your library yet.</p>;

  const groups = new Map<string, ConnectionEdge[]>();
  for (const e of edges) {
    const arr = groups.get(e.kind) ?? [];
    arr.push(e);
    groups.set(e.kind, arr);
  }

  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([kind, list]) => (
        <div key={kind}>
          <h4 className="mb-2 text-xs uppercase tracking-widest text-faint">{KIND_LABEL[kind] ?? kind}</h4>
          <div className="flex flex-wrap gap-2">
            {list.map((e) => (
              <Link
                key={`${kind}-${e.artist_id}`}
                href={`/artist/${e.artist_id}`}
                prefetch={false}
                className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1 text-sm text-bone transition-colors duration-150 ease-quiet hover:border-ember"
              >
                {e.name}
                <StatNumber className="text-xs text-faint">{Number(e.weight)}</StatNumber>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
