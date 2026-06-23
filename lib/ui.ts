// Small presentational helpers shared across screens.

/** Energy 1–10 → a color on the cool→ember scale (used sparingly, where it carries meaning). */
export function energyColor(energy: number | null | undefined): string {
  if (energy == null) return "var(--faint)";
  const t = Math.max(0, Math.min(1, (energy - 1) / 9));
  const cool = [91, 122, 140]; // #5b7a8c
  const ember = [224, 97, 47]; // #e0612f
  const c = cool.map((lo, i) => Math.round(lo + (ember[i]! - lo) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatMonth(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

export function year(d: string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "" : String(date.getFullYear());
}
