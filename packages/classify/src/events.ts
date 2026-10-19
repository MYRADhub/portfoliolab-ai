export type NewsClass = "fundamental" | "narrative" | "noise";

export interface EventTypeDef {
  slug: string;
  name: string;
  /** Prior used as a hint in the prompt; the classifier may override it with a stated mechanism. */
  defaultClass: NewsClass;
  definition: string;
}

/**
 * Draft event taxonomy, pending finance review (docs/event-taxonomy.md).
 * Fundamental: changes revenue, costs, assets, risk or cash flows.
 * Narrative: shifts expectations or sentiment with an uncertain direct economic effect.
 * Noise: attention or emotion with no clear economic mechanism.
 */
export const EVENT_TYPES = [
  {
    slug: "earnings_beat",
    name: "Earnings beat",
    defaultClass: "fundamental",
    definition: "Reported results exceed consensus or prior guidance.",
  },
  {
    slug: "earnings_miss",
    name: "Earnings miss",
    defaultClass: "fundamental",
    definition: "Reported results fall short of consensus or prior guidance.",
  },
  {
    slug: "guidance_raise",
    name: "Guidance raised",
    defaultClass: "fundamental",
    definition: "Company raises its forward revenue, profit or margin outlook.",
  },
  {
    slug: "guidance_cut",
    name: "Guidance cut",
    defaultClass: "fundamental",
    definition: "Company lowers or withdraws its forward outlook.",
  },
  {
    slug: "customer_win",
    name: "Major customer win",
    defaultClass: "fundamental",
    definition:
      "A large contract, customer or partnership is announced with disclosed or clearly material scale.",
  },
  {
    slug: "customer_loss",
    name: "Major customer loss",
    defaultClass: "fundamental",
    definition: "A significant customer, contract or distribution channel is lost.",
  },
  {
    slug: "product_launch",
    name: "Product launch",
    defaultClass: "narrative",
    definition: "A new product or service is announced; economic effect depends on adoption.",
  },
  {
    slug: "product_failure",
    name: "Product failure or recall",
    defaultClass: "fundamental",
    definition: "Safety recall, outage, defect or failed trial with direct cost or revenue impact.",
  },
  {
    slug: "m_and_a",
    name: "Merger or acquisition",
    defaultClass: "fundamental",
    definition: "Announced or completed acquisition, merger, divestiture or spin-off.",
  },
  {
    slug: "regulation_action",
    name: "Regulatory action",
    defaultClass: "fundamental",
    definition:
      "New law, rule, fine, approval or enforcement that changes what the company may do or earn.",
  },
  {
    slug: "export_controls",
    name: "Export controls or sanctions",
    defaultClass: "fundamental",
    definition: "Government restricts trade in a product, technology or market.",
  },
  {
    slug: "litigation",
    name: "Litigation outcome",
    defaultClass: "fundamental",
    definition:
      "Court ruling, settlement or major new lawsuit with a stated or estimable financial exposure.",
  },
  {
    slug: "supply_disruption",
    name: "Supply chain disruption",
    defaultClass: "fundamental",
    definition:
      "Shortage, outage, strike, disaster or logistics failure affecting production or delivery.",
  },
  {
    slug: "capex_announcement",
    name: "Capital spending announcement",
    defaultClass: "fundamental",
    definition:
      "Company or industry announces large investment plans (data centers, fabs, plants).",
  },
  {
    slug: "capital_return",
    name: "Dividend or buyback change",
    defaultClass: "fundamental",
    definition: "Dividend initiated, raised, cut, or buyback authorized or suspended.",
  },
  {
    slug: "credit_rating",
    name: "Credit rating change",
    defaultClass: "fundamental",
    definition: "Rating agency upgrades or downgrades the company's debt.",
  },
  {
    slug: "restructuring",
    name: "Layoffs or restructuring",
    defaultClass: "fundamental",
    definition: "Workforce reduction, plant closure or reorganization with stated cost or savings.",
  },
  {
    slug: "leadership_change",
    name: "Executive change",
    defaultClass: "narrative",
    definition:
      "CEO, CFO or other senior executive appointed or departs; fundamental only if tied to performance or strategy.",
  },
  {
    slug: "macro_data",
    name: "Macro data release",
    defaultClass: "fundamental",
    definition: "Inflation, jobs, GDP, PMI or similar official data surprises.",
  },
  {
    slug: "central_bank",
    name: "Central bank decision",
    defaultClass: "fundamental",
    definition: "Interest rate decision, guidance or balance-sheet policy change.",
  },
  {
    slug: "commodity_shock",
    name: "Commodity price shock",
    defaultClass: "fundamental",
    definition: "A sharp move in oil, gas, metals or agricultural prices with a stated cause.",
  },
  {
    slug: "analyst_action",
    name: "Analyst rating or target change",
    defaultClass: "narrative",
    definition: "Upgrade, downgrade or price-target change without new company information.",
  },
  {
    slug: "index_change",
    name: "Index inclusion or removal",
    defaultClass: "narrative",
    definition:
      "Added to or removed from an index, causing forced flows rather than changed economics.",
  },
  {
    slug: "insider_trade",
    name: "Insider or fund filing",
    defaultClass: "narrative",
    definition: "Insider transactions, 13F positions or large holder disclosures.",
  },
  {
    slug: "activist_stake",
    name: "Activist investor stake",
    defaultClass: "narrative",
    definition:
      "An activist discloses a stake or demands changes; fundamental only if a concrete plan is announced.",
  },
  {
    slug: "rumor",
    name: "Unconfirmed rumor",
    defaultClass: "narrative",
    definition:
      "Report based on unnamed sources or speculation, not confirmed by the company or filings.",
  },
  {
    slug: "public_controversy",
    name: "Public controversy",
    defaultClass: "narrative",
    definition:
      "Controversial statement, social media dispute or boycott call; fundamental only if customers or regulators act.",
  },
  {
    slug: "personal_life",
    name: "Executive personal life",
    defaultClass: "noise",
    definition:
      "Relationships, family, health rumors or lifestyle stories about an executive with no business link.",
  },
  {
    slug: "price_recap",
    name: "Price move recap",
    defaultClass: "noise",
    definition: "Article only reports that the stock moved, without a new cause.",
  },
  {
    slug: "routine_pr",
    name: "Routine corporate PR",
    defaultClass: "noise",
    definition:
      "Awards, sponsorships, conference appearances, charity and similar promotional items.",
  },
  {
    slug: "other",
    name: "Other",
    defaultClass: "narrative",
    definition: "None of the above fits; explain in the mechanism field.",
  },
] as const satisfies readonly EventTypeDef[];

export type EventSlug = (typeof EVENT_TYPES)[number]["slug"];

export const EVENT_SLUGS = EVENT_TYPES.map((e) => e.slug) as [EventSlug, ...EventSlug[]];
