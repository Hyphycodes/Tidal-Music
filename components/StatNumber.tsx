import type { ReactNode } from "react";

// Data reads like an instrument — numbers in mono.
export function StatNumber({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono tabular-nums ${className}`}>{children}</span>;
}

/** label + mono value, used in the Detail "instrument readout". */
export function DataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs uppercase tracking-wide text-faint">{label}</span>
      <span className="font-mono text-sm tabular-nums text-bone">{children}</span>
    </div>
  );
}
