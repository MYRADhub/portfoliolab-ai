export type RelevanceBand = "high" | "medium" | "low";

/** Plain-word bands for the 0 to 10 relevance score, so the number is never the only signal. */
export function relevanceBand(score: number): { band: RelevanceBand; label: string } {
  if (score >= 5) return { band: "high", label: "High" };
  if (score >= 2) return { band: "medium", label: "Medium" };
  return { band: "low", label: "Low" };
}
