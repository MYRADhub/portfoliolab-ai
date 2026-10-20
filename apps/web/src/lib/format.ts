export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
export const signedPct = (x: number, digits = 1) => `${x >= 0 ? "+" : ""}${pct(x, digits)}`;

/** "3 hours ago", "2 days ago". */
export function formatAge(days: number): string {
  const hours = days * 24;
  if (hours < 1) return "under an hour ago";
  if (hours < 24) return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"} ago`;
  const d = Math.floor(days);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
