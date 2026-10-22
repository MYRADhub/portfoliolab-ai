import type { ExplainGenerator, Fact } from "@portfolio-lab/explain";
import { factsFromEntries } from "@portfolio-lab/explain";
import type { Db } from "@portfolio-lab/db";
import { pct, signedPct } from "@/lib/format";
import { runGroundedExplanation, type ExplainResult } from "./explain";
import { getRebalance } from "./rebalance";
import { getSimulation } from "./simulation";
import { runStress, STRESS_PRESETS } from "./stress";

export type ToolParams =
  | { tool: "stress"; preset?: string; shocks?: Record<string, number> }
  | { tool: "rebalance"; maxWeight?: number }
  | { tool: "simulation"; years?: number; drift?: number | "historical" };

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

/** Facts for a tool's current result, recomputed on the server so the explanation can only quote real figures. */
export async function buildToolFacts(
  db: Db,
  sid: string,
  pid: string,
  p: ToolParams,
): Promise<Built> {
  if (p.tool === "stress") return stressFacts(db, sid, pid, p);
  if (p.tool === "rebalance") return rebalanceFacts(db, sid, pid, p);
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
