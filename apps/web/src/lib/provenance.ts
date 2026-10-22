export type Provenance = "draft" | "illustrative" | "reviewed";

/** Where an exposure score came from, read from the label written into its rationale when it was stored. */
export function exposureProvenance(rationale: string | null | undefined): Provenance {
  if (rationale?.startsWith("AI-drafted")) return "draft";
  if (rationale?.startsWith("Demo data")) return "illustrative";
  return "reviewed";
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  draft: "AI draft, not reviewed",
  illustrative: "Illustrative, not reviewed",
  reviewed: "Reviewed",
};
