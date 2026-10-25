import type { Db } from "@portfolio-lab/db";
import { EARNINGS_TYPES, getEventStudy } from "./events";
import { estimateForces, FORCE_DAYS } from "./forces";
import { getPooledSpilloverCached, type PooledReport } from "./spillover";

export type Verdict = "supported" | "not_supported" | "inconclusive" | "no_data";

export interface Finding {
  id: "spillover" | "sectors" | "earnings";
  question: string;
  verdict: Verdict;
  /** One plain sentence stating what was found. */
  result: string;
  /** The figures behind the sentence, as label and text pairs. */
  figures: { label: string; value: string }[];
  /** What this does not show. */
  caveats: string[];
  href: string;
}

export interface Evidence {
  generatedFor: string;
  findings: Finding[];
}

const r3 = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Pure: does the pooled spillover result support the claim that similar exposures move together? */
export function judgeSpillover(r: PooledReport): Verdict {
  const c = r.clusteredPartial;
  if (r.events === 0 || !c || c.t === null) return "no_data";
  if (c.t >= 2 && r.placebo.pPartial !== null && r.placebo.pPartial < 0.05) return "supported";
  if (c.t <= -2) return "not_supported";
  return "inconclusive";
}

/** Pure: do exposure scores describe the day-to-day differences between stocks better than sector labels do? */
export function judgeSectors(fit: {
  exposures: number;
  sectors: number;
  daysExposuresBetter: number;
}): Verdict {
  if (fit.exposures <= fit.sectors) return "not_supported";
  return fit.daysExposuresBetter >= 0.6 ? "supported" : "inconclusive";
}

/**
 * Pure: do earnings days move stocks by more than ordinary noise? By chance about 5% of days would move more than twice
 * a stock's normal noise, so a clearly larger share is evidence that earnings carry news.
 */
export function judgeEarnings(events: number, unusualShare: number | null): Verdict {
  if (events < 30 || unusualShare === null) return "no_data";
  if (unusualShare >= 0.15) return "supported";
  return unusualShare <= 0.07 ? "not_supported" : "inconclusive";
}

/**
 * The product's central claims, each tested on real data right now and reported with its verdict, figures and
 * limits. Nothing here is written in advance: every sentence and number is produced from the same calculations the
 * other pages use.
 */
export async function getEvidence(db: Db, opts: { now?: Date } = {}): Promise<Evidence> {
  const { now = new Date() } = opts;
  const [pooled, forces, events] = await Promise.all([
    getPooledSpilloverCached(db),
    estimateForces(db, { now, days: FORCE_DAYS, held: [] }),
    getEventStudy(db, opts.now ? { now: opts.now } : {}),
  ]);

  const findings: Finding[] = [];

  const sv = judgeSpillover(pooled);
  const c = pooled.clusteredPartial;
  findings.push({
    id: "spillover",
    question:
      "When a large company reports earnings, do stocks with similar hidden exposures move with it?",
    verdict: sv,
    result:
      sv === "no_data"
        ? "There are not enough earnings days with enough comparable stocks to test this."
        : sv === "supported"
          ? "Yes, slightly: similar stocks moved the same way, beyond what sector explains, and shuffled scores do not reproduce it."
          : sv === "not_supported"
            ? "No: similar stocks tended to move the opposite way."
            : "No reliable relationship survived the stricter checks.",
    figures: c
      ? [
          {
            label: "Earnings days pooled",
            value: `${pooled.events} (${pooled.companies.length} companies)`,
          },
          { label: "Independent weeks", value: String(pooled.clusters) },
          { label: "Sector-adjusted correlation", value: r3(pooled.partialCorrelation!.mean) },
          {
            label: "t-statistic counting each week once",
            value: c.t === null ? "n/a" : c.t.toFixed(2),
          },
          {
            label: "Placebo p-value",
            value: pooled.placebo.pPartial === null ? "n/a" : pooled.placebo.pPartial.toFixed(3),
          },
        ]
      : [],
    caveats: [
      "The effect is small.",
      "Calendar weeks are a coarse way to account for days that share market conditions.",
      "The exposure scores are AI drafts that no person has reviewed.",
    ],
    href: "/events",
  });

  if (forces) {
    const sj = judgeSectors(forces.fit);
    findings.push({
      id: "sectors",
      question: "Do the hidden-exposure scores describe stocks better than sector labels?",
      verdict: sj,
      result:
        sj === "supported"
          ? "Yes: exposure scores explained more of the daily differences between stocks than sector labels did, on most days."
          : sj === "not_supported"
            ? "No: sector labels did at least as well."
            : "Exposure scores did a little better on average but not consistently.",
      figures: [
        { label: "Explained by exposure scores", value: p1(forces.fit.exposures) },
        { label: "Explained by sector labels", value: p1(forces.fit.sectors) },
        {
          label: "Days exposure scores did better",
          value: `${Math.round(forces.fit.daysExposuresBetter * 100)}%`,
        },
        { label: "Stocks per day", value: String(forces.universe.stocks) },
        { label: "Days", value: String(forces.dates.length) },
      ],
      caveats: [
        "Both are fitted on the same day they are measured on, so this is not a forecast.",
        "Both figures are adjusted for how many columns each uses, and daily stock moves are mostly noise.",
        "The exposure scores are AI drafts that no person has reviewed.",
      ],
      href: "/forces",
    });
  } else {
    findings.push({
      id: "sectors",
      question: "Do the hidden-exposure scores describe stocks better than sector labels?",
      verdict: "no_data",
      result: "Not enough companies have exposure profiles and prices to test this.",
      figures: [],
      caveats: [],
      href: "/forces",
    });
  }

  const earn = events.byType.filter((t) => EARNINGS_TYPES.has(t.slug) && t.n > 0);
  const n = earn.reduce((s, t) => s + t.n, 0);
  const weighted = (pick: (t: (typeof earn)[number]) => number | null) => {
    const parts = earn.filter((t) => pick(t) !== null);
    const w = parts.reduce((s, t) => s + t.n, 0);
    return w > 0 ? parts.reduce((s, t) => s + pick(t)! * t.n, 0) / w : null;
  };
  const unusual = weighted((t) => t.unusualShare);
  const typical = weighted((t) => t.typicalMove);
  const ej = judgeEarnings(n, unusual);
  findings.push({
    id: "earnings",
    question: "Do earnings days move stocks by more than an ordinary day?",
    verdict: ej,
    result:
      ej === "no_data"
        ? "There are not enough studied earnings events to say."
        : ej === "supported"
          ? "Yes: far more earnings days than chance would give moved the stock by more than twice its normal noise."
          : ej === "not_supported"
            ? "No: earnings days looked like ordinary days."
            : "Earnings days were somewhat more eventful than ordinary days.",
    figures:
      unusual === null
        ? []
        : [
            { label: "Earnings events studied", value: String(n) },
            { label: "Typical move either way", value: typical === null ? "n/a" : p1(typical) },
            { label: "Share of unusual days", value: p1(unusual) },
            { label: "Share expected by chance", value: "about 5%" },
          ],
    caveats: [
      "The market is an equal-weighted average of other S&P 500 stocks, not an official index.",
      "Prices come from an unofficial free source.",
      "Direction is not tested here: the average abnormal return is close to zero because good and bad news cancel.",
    ],
    href: "/events",
  });

  return { generatedFor: now.toISOString().slice(0, 10), findings };
}
