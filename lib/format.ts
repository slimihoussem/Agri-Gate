/** Display formatting helpers — ISO timestamps in, human strings out. */

/** "just now" / "5m ago" / "2h ago" / "3d ago" / date fallback. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso; // mock strings pass through untouched
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** "Sat, Aug 22 · 05:30" style local timestamp. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** HH:MM local clock label (chart axes, tooltips). */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "n/a" placeholder for nullable numerics (NPK on disconnected zones). */
export function num(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

/**
 * Compact area label for a drawn boundary. Formats the STORED/DRAWN value in
 * hectares ("12.4 ha") or returns an explicit fallback when the boundary/value
 * is missing. Used by the Farm Map legend, header, and zone popup — it only
 * formats the already-computed value, never re-calculates it.
 */
export function formatAreaHectares(
  ha: number | null | undefined,
  fallback = "not drawn"
): string {
  if (ha === null || ha === undefined || !Number.isFinite(ha)) return fallback;
  const rounded = Math.round(ha * 10) / 10;
  return `${rounded} ha`;
}
