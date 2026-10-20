import { eq } from "drizzle-orm";
import { portfolios, type Db } from "@portfolio-lab/db";
import { AppError } from "./errors";
import { createPortfolio } from "./portfolios";

export interface SampleDef {
  key: string;
  name: string;
  /** One sentence on what the portfolio is. */
  blurb: string;
  /** What looking at it teaches. */
  lesson: string;
  holdings: { ticker: string; weightPct: number }[];
}

/** Ready-made portfolios for exploring the app. Every ticker is a current S&P 500 member. */
export const SAMPLES: SampleDef[] = [
  {
    key: "mega-cap-tech",
    name: "Sample: Mega-cap tech",
    blurb: "Five of the best-known technology and internet names.",
    lesson:
      "Looks diversified (five stocks) but shares AI, cloud, China and interest-rate risk. Compare sectors with factors on the Exposures page.",
    holdings: [
      { ticker: "NVDA", weightPct: 25 },
      { ticker: "AAPL", weightPct: 20 },
      { ticker: "MSFT", weightPct: 20 },
      { ticker: "AMZN", weightPct: 15 },
      { ticker: "GOOGL", weightPct: 20 },
    ],
  },
  {
    key: "balanced",
    name: "Sample: Balanced across sectors",
    blurb: "Ten companies spread over ten different industries.",
    lesson:
      "Low correlation and many independent risk factors. Compare its effective number of factors with the tech portfolio.",
    holdings: [
      { ticker: "AAPL", weightPct: 10 },
      { ticker: "JPM", weightPct: 12 },
      { ticker: "JNJ", weightPct: 12 },
      { ticker: "XOM", weightPct: 10 },
      { ticker: "PG", weightPct: 10 },
      { ticker: "UNH", weightPct: 10 },
      { ticker: "HD", weightPct: 8 },
      { ticker: "NEE", weightPct: 8 },
      { ticker: "CAT", weightPct: 10 },
      { ticker: "LIN", weightPct: 10 },
    ],
  },
  {
    key: "ai-boom",
    name: "Sample: AI boom bet",
    blurb: "Chipmakers and a software giant, all tied to AI spending.",
    lesson:
      "One force drives almost everything: see the Taiwan supply chain risk and the largest-factor share on Exposures.",
    holdings: [
      { ticker: "NVDA", weightPct: 30 },
      { ticker: "AMD", weightPct: 20 },
      { ticker: "AVGO", weightPct: 20 },
      { ticker: "MU", weightPct: 15 },
      { ticker: "MSFT", weightPct: 15 },
    ],
  },
  {
    key: "defensive",
    name: "Sample: Defensive staples",
    blurb: "Household names people buy in good times and bad.",
    lesson:
      "Lower volatility and shallower drawdowns on the Terminal page, but a shared exposure to a strong dollar and input costs.",
    holdings: [
      { ticker: "KO", weightPct: 20 },
      { ticker: "PG", weightPct: 20 },
      { ticker: "JNJ", weightPct: 20 },
      { ticker: "PEP", weightPct: 15 },
      { ticker: "WMT", weightPct: 15 },
      { ticker: "NEE", weightPct: 10 },
    ],
  },
  {
    key: "energy-and-banks",
    name: "Sample: Energy and banks",
    blurb: "Oil majors paired with large banks.",
    lesson:
      "Different industries that respond to different forces: oil prices for one group, interest rates for the other. Check the shared and offsetting risks.",
    holdings: [
      { ticker: "XOM", weightPct: 25 },
      { ticker: "CVX", weightPct: 20 },
      { ticker: "JPM", weightPct: 20 },
      { ticker: "BAC", weightPct: 15 },
      { ticker: "GS", weightPct: 10 },
      { ticker: "WFC", weightPct: 10 },
    ],
  },
];

export interface LoadSamplesResult {
  created: { key: string; id: string; name: string }[];
  /** Samples the visitor already has (matched by name), left untouched. */
  existing: { key: string; name: string }[];
  /** Samples that could not be created, with the reason. */
  skipped: { key: string; reason: string }[];
}

/** Creates the chosen samples (all by default) in the visitor's session. Safe to call repeatedly. */
export async function loadSamples(
  db: Db,
  sessionId: string,
  keys?: readonly string[],
): Promise<LoadSamplesResult> {
  const wanted = keys ?? SAMPLES.map((s) => s.key);
  const unknown = wanted.filter((k) => !SAMPLES.some((s) => s.key === k));
  if (unknown.length)
    throw new AppError("bad_request", `Unknown sample: ${unknown.join(", ")}`, { unknown });

  const have = new Set(
    (
      await db
        .select({ name: portfolios.name })
        .from(portfolios)
        .where(eq(portfolios.sessionId, sessionId))
    ).map((p) => p.name),
  );
  const result: LoadSamplesResult = { created: [], existing: [], skipped: [] };
  // Oldest first so the first sample ends up lowest in the newest-first list, as in the order shown on screen.
  for (const sample of SAMPLES.filter((s) => wanted.includes(s.key)).reverse()) {
    if (have.has(sample.name)) {
      result.existing.push({ key: sample.key, name: sample.name });
      continue;
    }
    try {
      const p = await createPortfolio(db, sessionId, {
        name: sample.name,
        normalize: false,
        holdings: sample.holdings,
      });
      result.created.push({ key: sample.key, id: p.id, name: sample.name });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      result.skipped.push({ key: sample.key, reason: e.message });
    }
  }
  result.created.reverse();
  result.existing.reverse();
  return result;
}
