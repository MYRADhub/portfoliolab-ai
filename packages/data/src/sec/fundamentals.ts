import { z } from "zod";
import { ProviderError } from "../providers/types";

export interface AnnualFigure {
  metric: string;
  fiscalYear: number;
  periodEnd: string;
  value: number;
  unit: string;
  filedAt: string;
  accession: string;
}

interface MetricSpec {
  metric: string;
  tags: string[];
  unit: string;
  /** Flow metrics cover a year; stock metrics are a point in time. */
  kind: "flow" | "instant";
}

export const METRICS: MetricSpec[] = [
  {
    metric: "revenue",
    tags: [
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
    ],
    unit: "USD",
    kind: "flow",
  },
  { metric: "net_income", tags: ["NetIncomeLoss", "ProfitLoss"], unit: "USD", kind: "flow" },
  { metric: "operating_income", tags: ["OperatingIncomeLoss"], unit: "USD", kind: "flow" },
  { metric: "eps_diluted", tags: ["EarningsPerShareDiluted"], unit: "USD/shares", kind: "flow" },
  {
    metric: "operating_cash_flow",
    tags: ["NetCashProvidedByUsedInOperatingActivities"],
    unit: "USD",
    kind: "flow",
  },
  { metric: "total_assets", tags: ["Assets"], unit: "USD", kind: "instant" },
  {
    metric: "equity",
    tags: [
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
    unit: "USD",
    kind: "instant",
  },
];

const factSchema = z.object({
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  accn: z.string(),
  form: z.string(),
  filed: z.string(),
});

const factsSchema = z.object({
  facts: z.record(
    z.string(),
    z.record(z.string(), z.object({ units: z.record(z.string(), z.array(factSchema)) })),
  ),
});

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/**
 * Annual figures from 10-K filings in an EDGAR company-facts response. Flow metrics must cover about a year.
 * Each period keeps the most recently filed value (restated figures replace originals), the first tag in the
 * metric's list that has the period wins, and only the latest `years` fiscal years are returned.
 */
export function extractAnnual(raw: unknown, years = 6): AnnualFigure[] {
  const parsed = factsSchema.safeParse(raw);
  if (!parsed.success)
    throw new ProviderError("sec", "unexpected company facts shape", "bad_response");
  const gaap = parsed.data.facts["us-gaap"] ?? {};
  const out: AnnualFigure[] = [];

  for (const spec of METRICS) {
    const byEnd = new Map<string, AnnualFigure>();
    for (const tag of spec.tags) {
      const entries = gaap[tag]?.units[spec.unit] ?? [];
      const best = new Map<string, z.infer<typeof factSchema>>();
      for (const e of entries) {
        if (e.form !== "10-K") continue;
        if (
          spec.kind === "flow" &&
          (!e.start || days(e.start, e.end) < 350 || days(e.start, e.end) > 380)
        )
          continue;
        const prev = best.get(e.end);
        if (!prev || e.filed > prev.filed) best.set(e.end, e);
      }
      for (const [end, e] of best) {
        if (byEnd.has(end)) continue;
        byEnd.set(end, {
          metric: spec.metric,
          fiscalYear: Number(end.slice(0, 4)),
          periodEnd: end,
          value: e.val,
          unit: spec.unit,
          filedAt: e.filed,
          accession: e.accn,
        });
      }
    }
    // One row per fiscal year: when a 52/53-week calendar puts two period ends in one year, keep the later.
    const byYear = new Map<number, AnnualFigure>();
    for (const f of [...byEnd.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)))
      byYear.set(f.fiscalYear, f);
    out.push(...[...byYear.values()].sort((a, b) => b.fiscalYear - a.fiscalYear).slice(0, years));
  }
  return out;
}
