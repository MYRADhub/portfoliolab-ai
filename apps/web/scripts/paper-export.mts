// Usage (from apps/web, against the real-data database):
//   DATABASE_URL=.../pl_real tsx scripts/paper-export.ts
// Writes every figure the paper reports to paper/data/, using the same functions the app uses. The paper never types
// a number by hand: paper/check.py turns these files into LaTeX macros and re-derives the main ones independently.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { and, isNotNull, sql } from "drizzle-orm";
import { companies, companyFactorExposures, createDb, factors } from "@portfolio-lab/db";
import {
  concentration,
  factorConcentration,
  factorLoadings,
  mulberry32,
} from "@portfolio-lab/finance";
import { getDraftAgreement, agreementCsv } from "../src/server/agreement";
import { getEventStudy, EARNINGS_TYPES } from "../src/server/events";
import { getEvidence } from "../src/server/evidence";
import { estimateForces, FORCE_DAYS } from "../src/server/forces";
import { exposureMap } from "../src/server/research";
import { getPriceCheck } from "../src/server/price-check";
import { getPooledSpillover } from "../src/server/spillover";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, close } = createDb(url);
const out = fileURLToPath(new URL("../../../paper/data/", import.meta.url));
await mkdir(out, { recursive: true });
const write = (name: string, body: string) => writeFile(`${out}${name}`, body);
const json = (name: string, v: unknown) => write(name, JSON.stringify(v, null, 2) + "\n");
const csv = (name: string, head: string[], rows: (string | number | boolean | null)[][]) =>
  write(
    name,
    [
      head.join(","),
      ...rows.map((r) => r.map((v) => (v === null ? "" : String(v))).join(",")),
    ].join("\n") + "\n",
  );

// Fix "now" to the day after the last price, so a rerun on the same data gives the same paper.
const [{ last }] = (await db.execute<{ last: string }>(
  sql`select max(date)::text as last from prices_daily`,
)) as unknown as { last: string }[];
const now = new Date(`${last}T00:00:00Z`);
now.setUTCDate(now.getUTCDate() + 1);
console.log(`data through ${last}`);

const all = await db.select().from(companies);
const profiles = await exposureMap(db);
const sectorOf = new Map(all.map((c) => [c.id, c.sector ?? "Unclassified"]));
const tickerOf = new Map(all.map((c) => [c.id, c.ticker]));

// 0. Force names, for the paper's tables.
await json(
  "forces.json",
  Object.fromEntries((await db.select().from(factors)).map((f) => [f.slug, f.name])),
);

// 1. The exposure table itself.
const expoRows: (string | number)[][] = [];
for (const [id, v] of profiles)
  for (const [slug, s] of Object.entries(v))
    if (s !== 0) expoRows.push([tickerOf.get(id)!, sectorOf.get(id)!, slug, s]);
expoRows.sort(
  (a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])),
);
await csv("exposures.csv", ["ticker", "sector", "force", "score"], expoRows);

// 2. Random portfolios: does spreading across sectors spread across forces?
const ids = [...profiles.keys()].sort((a, b) => a - b);
const rand = mulberry32(20261026);
const SIZE = 10;
const N = 2000;
const portfolios: (string | number)[][] = [];
for (let k = 0; k < N; k++) {
  const pick = new Set<number>();
  while (pick.size < SIZE) pick.add(ids[Math.floor(rand() * ids.length)]!);
  const members = [...pick].sort((a, b) => a - b);
  const w = 1 / SIZE;
  const bySector = new Map<string, number>();
  for (const id of members)
    bySector.set(sectorOf.get(id)!, (bySector.get(sectorOf.get(id)!) ?? 0) + w);
  const conc = factorConcentration(
    factorLoadings(
      members.map((id) => ({ ticker: tickerOf.get(id)!, weight: w, exposures: profiles.get(id)! })),
    ),
  );
  portfolios.push([
    k,
    members.map((id) => tickerOf.get(id)!).join("|"),
    bySector.size,
    concentration([...bySector.values()]).effectiveN,
    conc.effectiveFactors ?? "",
    conc.topShare ?? "",
  ]);
}
await csv(
  "random-portfolios.csv",
  ["id", "tickers", "sectors", "effective_sectors", "effective_forces", "top_force_share"],
  portfolios,
);

// 3. Exposures against sectors, and the forces' own returns.
const forces = await estimateForces(db, { now, days: FORCE_DAYS, held: [] });
if (forces) {
  await json("forces-fit.json", {
    days: forces.dates.length,
    from: forces.dates[0],
    to: forces.dates.at(-1),
    stocks: forces.universe.stocks,
    fit: forces.fit,
  });
  const cum = forces.slugs.map(() => 0);
  await csv(
    "force-returns.csv",
    ["date", ...forces.slugs],
    // series is one row per force, one column per day.
    forces.dates.map((d, i) => [
      d,
      ...forces.slugs.map((_, j) => {
        cum[j]! += forces.series[j]![i]!;
        return +cum[j]!.toFixed(8);
      }),
    ]),
  );
}

// 3b. The same fit with the earlier scores drafted from the model's general knowledge, where a company has them.
// Those rows are kept as closed history when a report-grounded draft replaces them, so both versions can be compared.
const history = await db
  .select({
    companyId: companyFactorExposures.companyId,
    slug: factors.slug,
    magnitude: companyFactorExposures.magnitude,
    direction: companyFactorExposures.direction,
    version: companyFactorExposures.version,
    rationale: companyFactorExposures.rationale,
    evidenceQuote: companyFactorExposures.evidenceQuote,
  })
  .from(companyFactorExposures)
  .innerJoin(factors, sql`${factors.id} = ${companyFactorExposures.factorId}`)
  .where(and(isNotNull(companyFactorExposures.validTo)));
const memoryVersion = new Map<number, number>();
for (const r of history)
  if (!r.evidenceQuote && r.rationale?.startsWith("AI-drafted"))
    memoryVersion.set(r.companyId, Math.max(memoryVersion.get(r.companyId) ?? 0, r.version));
const grounded = new Set<number>();
const groundedRows = await db
  .select({ id: companyFactorExposures.companyId })
  .from(companyFactorExposures)
  .where(
    and(
      isNotNull(companyFactorExposures.evidenceQuote),
      sql`${companyFactorExposures.validTo} is null`,
    ),
  );
for (const r of groundedRows) grounded.add(r.id);
const memoryProfiles = new Map<number, Record<string, number>>();
for (const [id, v] of profiles) {
  const old = memoryVersion.get(id);
  if (!grounded.has(id) || old === undefined) {
    memoryProfiles.set(id, v);
    continue;
  }
  const p: Record<string, number> = {};
  for (const r of history)
    if (r.companyId === id && r.version === old) p[r.slug] = r.magnitude * r.direction;
  memoryProfiles.set(id, p);
}
const memoryFit = await estimateForces(db, {
  now,
  days: FORCE_DAYS,
  held: [],
  profiles: memoryProfiles,
});
await json("forces-fit-memory.json", {
  companiesWithEarlierDraft: [...grounded].filter((id) => memoryVersion.has(id)).length,
  fit: memoryFit?.fit ?? null,
});

// 3c. The price check: each company's measured sensitivity to each force's market signal, before the tested year.
const check = await getPriceCheck(db, { now });
await json("price-check.json", {
  window: check.window,
  forces: check.forces,
});
const pcRows: (string | number)[][] = [];
for (const [id, v] of profiles) {
  const m = check.measured.get(tickerOf.get(id)!);
  if (!m) continue;
  for (const [slug, x] of Object.entries(m))
    pcRows.push([tickerOf.get(id)!, slug, v[slug] ?? 0, +x.t.toFixed(6)]);
}
await csv("price-check.csv", ["ticker", "force", "score", "t"], pcRows);

// 4. Event study: every reaction and the per-type summary.
const events = await getEventStudy(db, { now, allReactions: true });
await csv(
  "reactions.csv",
  ["ticker", "event_type", "earnings", "event_date", "overlaps_earnings", "ar0", "z0", "beta"],
  events.reactions.map((r) => [
    r.ticker,
    r.eventType,
    r.eventType !== null && EARNINGS_TYPES.has(r.eventType),
    r.eventDate,
    r.overlapsEarnings,
    +r.ar0.toFixed(8),
    r.z0 === null ? null : +r.z0.toFixed(8),
    +r.beta.toFixed(6),
  ]),
);
await json("event-study.json", {
  window: events.window,
  universe: events.universe,
  eventsFound: events.eventsFound,
  eventsStudied: events.eventsStudied,
  skipped: events.skipped,
  byType: events.byType,
});

// 5. Pooled spillover test.
// More shuffles than the page uses, so the placebo p-value is not stuck at its floor of 1/201.
const PLACEBO_SHUFFLES = 2000;
const pooled = await getPooledSpillover(db, { now, permutations: PLACEBO_SHUFFLES });
await json("spillover.json", pooled);

// 6. AI against blind human scores.
const agreement = await getDraftAgreement(db);
await write("agreement.csv", agreementCsv(agreement));
await json("agreement.json", { ...agreement, cells: undefined });

// 7. The Evidence page's verdicts, as the app states them.
await json("evidence.json", await getEvidence(db, { now }));

await json("meta.json", {
  dataThrough: last,
  companies: all.length,
  profiled: profiles.size,
  exposureRows: expoRows.length,
  grounded: grounded.size,
  randomPortfolios: { n: N, size: SIZE, seed: 20261026 },
  placeboShuffles: PLACEBO_SHUFFLES,
});
await close();
console.log(`wrote paper data to ${out}`);
