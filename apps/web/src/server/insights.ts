import type { Db } from "@portfolio-lab/db";
import { pct } from "@/lib/format";
import { getPortfolioMove, signedPct2 } from "./move";
import { getTerminal, type Terminal } from "./terminal";

export type Severity = "alert" | "watch" | "info";

export interface Insight {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  href: string;
  linkLabel: string;
}

/** Thresholds that decide when an insight is worth the investor's attention. They are judgment calls, listed in one place. */
export const THRESHOLDS = {
  /** A holding is flagged when its share of risk exceeds its weight by this factor. */
  riskOverweight: 1.25,
  /** A single economic force is flagged when it makes up at least this share of exposure. */
  topFactorShare: 0.25,
  /** Average pairwise correlation at or above this is flagged. */
  highCorrelation: 0.6,
  /** Distance below the all-time peak that raises a watch or an alert. */
  drawdownWatch: -0.05,
  drawdownAlert: -0.1,
  /** News at or above this relevance score is called out. */
  highRelevance: 5,
  /** A daily move at least this large is called out as worth a look. */
  bigMove: 0.015,
} as const;

const ORDER: Record<Severity, number> = { alert: 0, watch: 1, info: 2 };

/** Current distance below the highest index value reached so far (negative or zero). */
export function currentDrawdown(equity: readonly { value: number }[]): number {
  let peak = -Infinity;
  for (const p of equity) peak = Math.max(peak, p.value);
  return equity.at(-1)!.value / peak - 1;
}

export function buildInsights(
  t: Terminal,
  move: { date: string; portfolioReturn: number; headline: string },
): Insight[] {
  const out: Insight[] = [];

  // 1. Sectors versus hidden forces: the product's central comparison.
  if (t.exposures.available && t.exposures.effectiveFactors !== null) {
    const s = t.exposures.effectiveSectors;
    const f = t.exposures.effectiveFactors;
    out.push(
      f < s
        ? {
            id: "hidden-concentration",
            severity: "watch",
            title: "You are more concentrated than your sectors suggest",
            detail: `By sector you look like ${s.toFixed(1)} separate groups, but by the economic forces you depend on you look like only ${f.toFixed(1)}.`,
            href: "/exposures",
            linkLabel: "See the exposure map",
          }
        : {
            id: "hidden-concentration",
            severity: "info",
            title: "Your hidden forces are at least as spread as your sectors",
            detail: `By sector you look like ${s.toFixed(1)} groups and by economic force like ${f.toFixed(1)}.`,
            href: "/exposures",
            linkLabel: "See the exposure map",
          },
    );
  } else {
    const top = t.holdings[0]!;
    out.push({
      id: "hidden-concentration",
      severity: top.weight >= 0.3 ? "watch" : "info",
      title:
        top.weight >= 0.3
          ? `${top.ticker} is a large share of your portfolio`
          : "No single holding dominates",
      detail: `${top.ticker} is ${pct(top.weight, 0)} of your money. Hidden-force analysis needs exposure data for every holding.`,
      href: "/exposures",
      linkLabel: "Check exposure data",
    });
  }

  // 2. A holding that adds more risk than its size suggests.
  const worst = [...t.holdings].sort((a, b) => b.riskShare / b.weight - a.riskShare / a.weight)[0]!;
  out.push(
    worst.riskShare > worst.weight * THRESHOLDS.riskOverweight
      ? {
          id: "risk-driver",
          severity: "watch",
          title: `${worst.ticker} drives more risk than its size`,
          detail: `${worst.ticker} is ${pct(worst.weight, 0)} of your money but ${pct(worst.riskShare, 0)} of your portfolio's ups and downs.`,
          href: "/terminal#risk",
          linkLabel: "Compare risk and weight",
        }
      : {
          id: "risk-driver",
          severity: "info",
          title: "Risk is spread in line with position sizes",
          detail: `No holding adds more than 25% above its weight to the portfolio's risk.`,
          href: "/terminal#risk",
          linkLabel: "Compare risk and weight",
        },
  );

  // 3. The single largest economic force.
  if (
    t.exposures.available &&
    t.exposures.topFactors[0] &&
    t.exposures.topFactors[0].share >= THRESHOLDS.topFactorShare
  ) {
    const f = t.exposures.topFactors[0];
    out.push({
      id: "top-force",
      severity: "watch",
      title: `${f.name} is your biggest hidden force`,
      detail: `${pct(f.share, 0)} of your total factor exposure rests on ${f.name.toLowerCase()}.`,
      href: "/exposures",
      linkLabel: "See who depends on it",
    });
  }

  // 4. Where the portfolio stands against its peak.
  const dd = currentDrawdown(t.equity);
  out.push({
    id: "drawdown",
    severity:
      dd <= THRESHOLDS.drawdownAlert ? "alert" : dd <= THRESHOLDS.drawdownWatch ? "watch" : "info",
    title: dd > -0.0005 ? "At a new high" : `${pct(Math.abs(dd), 1)} below its peak`,
    detail:
      dd > -0.0005
        ? `The portfolio is at its highest level in this window. Its worst fall so far was ${pct(Math.abs(t.risk.maxDrawdown), 1)}.`
        : `The worst fall in this window was ${pct(Math.abs(t.risk.maxDrawdown), 1)}.`,
    href: "/terminal#risk",
    linkLabel: "See drawdowns",
  });

  // 5. The latest day's move.
  out.push({
    id: "latest-move",
    severity: Math.abs(move.portfolioReturn) >= THRESHOLDS.bigMove ? "watch" : "info",
    title: `Latest day: ${signedPct2(move.portfolioReturn)}`,
    detail: move.headline,
    href: "/dashboard#move",
    linkLabel: "See what drove it",
  });

  // 6. How closely holdings move together.
  if (t.correlation) {
    out.push(
      t.correlation.average >= THRESHOLDS.highCorrelation
        ? {
            id: "correlation",
            severity: "watch",
            title: "Your holdings move closely together",
            detail: `The average correlation between your holdings is ${t.correlation.average.toFixed(2)}, so they tend to rise and fall together.`,
            href: "/correlation",
            linkLabel: "See the matrix",
          }
        : {
            id: "correlation",
            severity: "info",
            title: "Your holdings do not move in lockstep",
            detail: `The average correlation between your holdings is ${t.correlation.average.toFixed(2)}.`,
            href: "/correlation",
            linkLabel: "See the matrix",
          },
    );
  }

  // 7. The most relevant story.
  const top = t.news[0];
  if (top) {
    out.push({
      id: "top-news",
      severity: top.score >= THRESHOLDS.highRelevance ? "watch" : "info",
      title:
        top.score >= THRESHOLDS.highRelevance
          ? "A high-relevance story for you"
          : "Latest relevant story",
      detail: `${top.title} (${top.tickers.join(", ")}, relevance ${top.score.toFixed(1)} of 10)`,
      href: "/news",
      linkLabel: "Open the news",
    });
  }

  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/** Plain-language cards for the Dashboard, computed from the same numbers shown elsewhere in the app. */
export async function getInsights(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { now?: Date } = {},
): Promise<{ insights: Insight[] }> {
  const t = await getTerminal(db, sessionId, portfolioId, opts);
  const move = await getPortfolioMove(db, sessionId, portfolioId, opts);
  return { insights: buildInsights(t, move) };
}
