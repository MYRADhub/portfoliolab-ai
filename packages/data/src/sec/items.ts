export interface ItemRule {
  /** Event type slug (see the event taxonomy, plus `earnings_release`). */
  slug: string;
  /** 0 to 10: how much the item type usually matters economically. A judgment, not a measurement. */
  importance: number;
  description: string;
}

/**
 * Form 8-K item numbers mapped to our event types. Items not listed here (for example 9.01 exhibits and 7.01
 * Regulation FD disclosure) carry no event of their own.
 */
export const ITEM_RULES: Record<string, ItemRule> = {
  "1.01": {
    slug: "customer_win",
    importance: 5,
    description: "Entry into a material definitive agreement",
  },
  "1.02": {
    slug: "customer_loss",
    importance: 5,
    description: "Termination of a material definitive agreement",
  },
  "1.05": { slug: "other", importance: 6, description: "Material cybersecurity incident" },
  "2.01": {
    slug: "m_and_a",
    importance: 8,
    description: "Completion of an acquisition or disposition of assets",
  },
  "2.02": {
    slug: "earnings_release",
    importance: 7,
    description: "Results of operations and financial condition",
  },
  "2.03": {
    slug: "other",
    importance: 3,
    description: "Creation of a direct financial obligation",
  },
  "2.05": {
    slug: "restructuring",
    importance: 6,
    description: "Costs associated with exit or disposal activities",
  },
  "2.06": { slug: "restructuring", importance: 6, description: "Material impairments" },
  "3.01": {
    slug: "other",
    importance: 5,
    description: "Notice of delisting or failure to satisfy a listing rule",
  },
  "4.02": {
    slug: "other",
    importance: 7,
    description: "Non-reliance on previously issued financial statements",
  },
  "5.01": { slug: "m_and_a", importance: 8, description: "Changes in control of the company" },
  "5.02": {
    slug: "leadership_change",
    importance: 5,
    description: "Departure or appointment of directors or officers",
  },
  "5.07": {
    slug: "routine_pr",
    importance: 1,
    description: "Submission of matters to a vote of shareholders",
  },
  "8.01": { slug: "other", importance: 2, description: "Other events" },
};

export interface EightKEvent {
  slug: string;
  importance: number;
  /** All mapped item descriptions, most important first. */
  descriptions: string[];
  /** The item the event was named after. */
  primaryItem: string;
}

/** Picks the most important mapped item as the event. Returns null when no item maps to an event. */
export function eventForItems(items: readonly string[]): EightKEvent | null {
  const mapped = items
    .map((i) => i.trim())
    .filter((i) => ITEM_RULES[i])
    .sort((a, b) => ITEM_RULES[b]!.importance - ITEM_RULES[a]!.importance || a.localeCompare(b));
  if (mapped.length === 0) return null;
  const top = ITEM_RULES[mapped[0]!]!;
  return {
    slug: top.slug,
    importance: top.importance,
    descriptions: mapped.map((i) => `Item ${i}: ${ITEM_RULES[i]!.description}`),
    primaryItem: mapped[0]!,
  };
}
