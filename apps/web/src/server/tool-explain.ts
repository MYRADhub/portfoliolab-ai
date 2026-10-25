import type { ExplainGenerator, Fact } from "@portfolio-lab/explain";
import { factsFromEntries } from "@portfolio-lab/explain";
import type { Db } from "@portfolio-lab/db";
import { pct, signedPct } from "@/lib/format";
import { runGroundedExplanation, type ExplainResult } from "./explain";
import { getBenchmark } from "./benchmark";
import { getRebalance } from "./rebalance";
import { getSimulation } from "./simulation";
import { runStress, STRESS_PRESETS } from "./stress";

export type ToolParams =
  | { tool: "stress"; preset?: string; shocks?: Record<string, number> }
  | { tool: "rebalance"; maxWeight?: number }
  | { tool: "simulation"; years?: number; drift?: number | "historical" }
  | { tool: "benchmark" };

interface Built {
  facts: Fact[];
  task: string;
}

const entries = (list: { label: string; text: string }[]) => factsFromEntries(list);

async function stressFacts(
  db: Db,
  sid: string,
  pid: string,
  p: Extract<ToolParams, { tool: "stress" }>,
): Promise<Built> {
  const r = await runStress(db, sid, pid, { preset: p.preset, shocks: p.shocks });
  if (!r.available || !r.touched)
    return {
      facts: entries([
        { label: "Scenario result", text: "no holding is exposed to this scenario" },
      ]),
      task: "Explain this stress test result.",
    };
  const preset = STRESS_PRESETS.find((x) => x.id === p.preset);
  const list = [
    { label: "Scenario", text: preset ? preset.name : "Custom scenario" },
    { label: "Estimated portfolio impact", text: signedPct(r.portfolioImpact, 2) },
    { label: "Vulnerability score", text: `${r.vulnerability.toFixed(1)} of 10` },
    {
      label: "Reliability of the exposure inputs",
      text: r.reliability === null ? "not available" : pct(r.reliability, 0),
    },
    {
      label: "Assumption",
      text: `each exposure point moves a stock by ${pct(r.percentPerPoint, 0)} under a full-size shock`,
    },
  ];
  for (const f of r.factors.slice(0, 3))
    list.push({
      label: "Force driving the result",
      text: `${f.name} ${signedPct(f.contribution, 2)}`,
    });
  for (const h of r.holdings.slice(0, 3))
    list.push({
      label: "Holding affected most",
      text: `${h.ticker} ${signedPct(h.impact, 1)} (weight ${pct(h.weight, 0)})`,
    });
  return {
    facts: entries(list),
    task: "Explain this stress test: what it estimates, which forces and holdings drive it, and how much to trust it. It is an illustrative what-if, not a forecast.",
  };
}

async function rebalanceFacts(
  db: Db,
  sid: string,
  pid: string,
  p: Extract<ToolParams, { tool: "rebalance" }>,
): Promise<Built> {
  const r = await getRebalance(db, sid, pid, { maxWeight: p.maxWeight });
  const list: { label: string; text: string }[] = [
    {
      label: "Window",
      text: `${r.window.from} to ${r.window.to} (${r.window.tradingDays} trading days)`,
    },
    { label: "Largest weight allowed in the lowest-volatility mix", text: pct(r.maxWeight, 0) },
  ];
  for (const s of r.strategies) {
    list.push({ label: `${s.name} volatility`, text: pct(s.volatility, 1) });
    list.push({ label: `${s.name} worst fall`, text: pct(s.maxDrawdown, 1) });
    list.push({ label: `${s.name} yearly return`, text: signedPct(s.annualReturn, 1) });
    if (s.effectiveFactors !== null)
      list.push({
        label: `${s.name} effective economic forces`,
        text: s.effectiveFactors.toFixed(1),
      });
  }
  const cur = r.strategies.find((s) => s.id === "current")!;
  const min = r.strategies.find((s) => s.id === "min_variance")!;
  const moves = min.weights
    .map((w, i) => ({ t: w.ticker, from: cur.weights[i]!.weight, to: w.weight }))
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))
    .slice(0, 3);
  for (const m of moves)
    list.push({
      label: "Biggest change in the lowest-volatility mix",
      text: `${m.t} from ${pct(m.from, 1)} to ${pct(m.to, 1)}`,
    });
  list.push({
    label: "Money moved to reach the lowest-volatility mix",
    text: pct(min.turnover, 0),
  });
  list.push({ label: "Caveat", text: "in-sample: fitted and measured on the same past period" });
  return {
    facts: entries(list),
    task: "Explain what comparing these weightings shows about where this portfolio's risk is concentrated. Stress that the results are in-sample and not advice, and do not tell the reader to change anything.",
  };
}

async function simulationFacts(
  db: Db,
  sid: string,
  pid: string,
  p: Extract<ToolParams, { tool: "simulation" }>,
): Promise<Built> {
  const r = await getSimulation(db, sid, pid, { years: p.years, drift: p.drift });
  const ret = (v: number) => signedPct(v / 100 - 1, 0);
  return {
    facts: entries([
      { label: "Horizon", text: `${r.horizonYears} ${r.horizonYears === 1 ? "year" : "years"}` },
      { label: "Simulated paths", text: String(r.paths) },
      { label: "History used", text: `${r.history.from} to ${r.history.to}` },
      { label: "Historical yearly return", text: signedPct(r.history.annualReturn, 1) },
      {
        label: "Yearly return the paths are centred on",
        text:
          r.assumedAnnualReturn === null
            ? "the portfolio's own past average"
            : `${pct(r.assumedAnnualReturn, 0)} (a typical long-run figure, not the past average)`,
      },
      { label: "Historical volatility", text: pct(r.history.volatility, 1) },
      { label: "Typical outcome", text: ret(r.summary.medianEnd) },
      { label: "Bad case, 1 in 20", text: ret(r.summary.p5End) },
      { label: "Good case, 1 in 20", text: ret(r.summary.p95End) },
      { label: "Chance of ending with a loss", text: pct(r.summary.probLoss, 0) },
      { label: "Chance of losing 20% or more", text: pct(r.summary.probLoss20, 0) },
      { label: "Typical worst drop along the way", text: pct(r.summary.medianMaxDrawdown, 0) },
    ]),
    task: "Explain what this simulation shows about the range of outcomes, and why it is a projection of the past and not a forecast.",
  };
}

async function benchmarkFacts(db: Db, sid: string, pid: string): Promise<Built> {
  const r = await getBenchmark(db, sid, pid);
  if (!r.available)
    return {
      facts: entries([{ label: "Market comparison", text: "not available: no benchmark prices" }]),
      task: "Explain that the comparison is not available.",
    };
  const s = r.stats;
  const list: { label: string; text: string }[] = [
    { label: "Benchmark", text: r.benchmark.name },
    {
      label: "Window",
      text: `${r.window.from} to ${r.window.to} (${r.window.tradingDays} trading days)`,
    },
    { label: "Beta", text: s.beta === null ? "not measurable" : s.beta.toFixed(2) },
    {
      label: "Correlation with the market",
      text: s.correlation === null ? "not measurable" : s.correlation.toFixed(2),
    },
    {
      label: "Yearly return beyond beta (alpha)",
      text: s.alpha === null ? "not measurable" : signedPct(s.alpha, 1),
    },
    {
      label: "Tracking error",
      text: s.trackingError === null ? "not measurable" : pct(s.trackingError, 1),
    },
    { label: "Yearly return minus the benchmark's", text: signedPct(s.activeReturn, 1) },
    {
      label: "Share of the market's up days captured",
      text: s.upCapture === null ? "not measurable" : pct(s.upCapture, 0),
    },
    {
      label: "Share of the market's down days captured",
      text: s.downCapture === null ? "not measurable" : pct(s.downCapture, 0),
    },
    { label: "Days the portfolio beat the market", text: pct(s.battingAverage, 0) },
  ];
  for (const y of r.years.filter((x) => !x.partial))
    list.push({
      label: `Calendar year ${y.year}`,
      text: `portfolio ${signedPct(y.portfolio, 1)}, market ${signedPct(y.benchmark, 1)}`,
    });
  return {
    facts: entries(list),
    task: "Explain how this portfolio behaved compared with the market: how much it moves with it, whether it earned anything beyond that, and how much of the market's good and bad days it took. Note that a few years of data make alpha noisy, and do not give advice.",
  };
}

/** Facts for a tool's current result, recomputed on the server so the explanation can only quote real figures. */
export async function buildToolFacts(
  db: Db,
  sid: string,
  pid: string,
  p: ToolParams,
): Promise<Built> {
  if (p.tool === "stress") return stressFacts(db, sid, pid, p);
  if (p.tool === "rebalance") return rebalanceFacts(db, sid, pid, p);
  if (p.tool === "benchmark") return benchmarkFacts(db, sid, pid);
  return simulationFacts(db, sid, pid, p);
}

export async function explainTool(
  db: Db,
  sessionId: string,
  portfolioId: string,
  p: ToolParams,
  generator: ExplainGenerator,
): Promise<ExplainResult> {
  const { facts, task } = await buildToolFacts(db, sessionId, portfolioId, p);
  return runGroundedExplanation(db, sessionId, facts, generator, {
    purpose: `tool_${p.tool}`,
    task,
  });
}
