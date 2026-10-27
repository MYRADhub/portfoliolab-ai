// Usage:
//   tsx src/exposures-cli.ts --eval              draft the companies that have hand-made profiles and report agreement (stores nothing)
//   tsx src/exposures-cli.ts [--limit N] [--tickers A,B]   draft and store profiles for companies that have none
//   tsx src/exposures-cli.ts --replace-illustrative         also redraft companies that only have made-up demo rows
//   tsx src/exposures-cli.ts --grounded [--runs 5] [--filed-before YYYY-MM-DD] [--tickers A,B] [--limit N]
//       draft from each company's last 10-K filed before the date (default: one year ago), every score backed by a
//       quote checked to appear in the report, the median of --runs answers stored. Replaces AI and demo rows that
//       are not grounded yet; never touches rows a person wrote. Needs SEC_USER_AGENT as well.
// Needs OPENAI_API_KEY and DATABASE_URL. Makes one API call per company and spends real money.
import OpenAI from "openai";
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { EdgarClient, extractTenKSections, filingUrl, findTenKBefore } from "@portfolio-lab/data";
import { companies, createDb } from "@portfolio-lab/db";
import {
  cleanDraft,
  draftAndStore,
  exposureAgreement,
  loadFactorInfo,
  loadProfiles,
  OpenAIExposureDrafter,
} from "./exposures";
import { DEFAULT_MODEL } from "./classifier";
import { DEFAULT_RUNS, draftGroundedAndStore, OpenAIGroundedDrafter } from "./grounded";

const { values } = parseArgs({
  options: {
    eval: { type: "boolean", default: false },
    limit: { type: "string" },
    tickers: { type: "string" },
    model: { type: "string", default: DEFAULT_MODEL },
    concurrency: { type: "string", default: "4" },
    "replace-illustrative": { type: "boolean", default: false },
    grounded: { type: "boolean", default: false },
    runs: { type: "string", default: String(DEFAULT_RUNS) },
    "filed-before": { type: "string" },
  },
});
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, close } = createDb(url);
const drafter = new OpenAIExposureDrafter(new OpenAI(), values.model);
const tickers = values.tickers?.split(",").map((t) => t.trim().toUpperCase());

if (values.grounded) {
  const ua = process.env.SEC_USER_AGENT;
  if (!ua)
    throw new Error(
      "SEC_USER_AGENT is required for --grounded, for example 'Jane Doe jane@example.edu'",
    );
  const edgar = new EdgarClient(ua);
  const filedBefore =
    values["filed-before"] ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const s = await draftGroundedAndStore(
    db,
    new OpenAIGroundedDrafter(new OpenAI(), values.model),
    {
      async get(c) {
        if (!c.cik) return null;
        const k = await findTenKBefore(edgar, c.cik, filedBefore);
        if (!k) return null;
        const url = filingUrl(c.cik, k);
        const sections = extractTenKSections(await edgar.document(url));
        return { url, filingDate: k.filingDate, reportDate: k.reportDate, ...sections };
      },
    },
    {
      tickers,
      limit: values.limit ? Number(values.limit) : undefined,
      runs: Number(values.runs),
      concurrency: Number(values.concurrency),
    },
  );
  console.log(
    `10-K filed before ${filedBefore}: drafted ${s.drafted}, stored ${s.stored} rows, skipped ${s.skipped}, ${s.unverified} exposures dropped for unverified quotes, ${s.failed.length} failed`,
  );
  console.log(
    `tokens: ${s.usage.input} input (${s.usage.cachedInput} cached), ${s.usage.output} output`,
  );
  for (const f of s.failed.slice(0, 30)) console.error(`  ${f.ticker}: ${f.reason}`);
} else if (values.eval) {
  const list = await loadFactorInfo(db);
  const slugs = new Set(list.map((f) => f.slug));
  const all = await db.select().from(companies);
  const profiles = await loadProfiles(
    db,
    all.map((c) => c.ticker),
  );
  const targets = all.filter(
    (c) => profiles.has(c.ticker) && (!tickers || tickers.includes(c.ticker)),
  );
  const rows: {
    ticker: string;
    draft: Record<string, number>;
    agreement: ReturnType<typeof exposureAgreement>;
  }[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Number(values.concurrency) }, async () => {
      while (i < targets.length) {
        const c = targets[i++]!;
        const raw = await drafter.draft(
          { ticker: c.ticker, name: c.name, sector: c.sector, industry: c.industry },
          list,
        );
        if (!raw) continue;
        const draft = Object.fromEntries(
          cleanDraft(raw, slugs).map((d) => [d.slug, d.magnitude * d.direction]),
        );
        rows.push({
          ticker: c.ticker,
          draft,
          agreement: exposureAgreement(draft, profiles.get(c.ticker)!),
        });
      }
    }),
  );
  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const summary = {
    model: values.model,
    companies: rows.length,
    meanCosine: mean(rows.map((r) => r.agreement.cosine)),
    meanDirectionAgreement: mean(rows.map((r) => r.agreement.directionAgreement)),
    meanMagnitudeError: mean(rows.map((r) => r.agreement.meanMagnitudeError)),
    meanRecallStrong: mean(rows.map((r) => r.agreement.recallStrong)),
    meanPrecisionStrong: mean(rows.map((r) => r.agreement.precisionStrong)),
  };
  for (const r of rows)
    console.log(
      `${r.ticker.padEnd(6)} cosine ${r.agreement.cosine?.toFixed(2) ?? "n/a"}  direction ${r.agreement.directionAgreement?.toFixed(2) ?? "n/a"}  recall ${r.agreement.recallStrong?.toFixed(2) ?? "n/a"}`,
    );
  console.log(summary);
  const outDir = fileURLToPath(new URL("../evals/out/", import.meta.url));
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}exposure-agreement.json`, JSON.stringify({ summary, rows }, null, 2));
} else {
  const s = await draftAndStore(db, drafter, {
    tickers,
    limit: values.limit ? Number(values.limit) : undefined,
    concurrency: Number(values.concurrency),
    replaceIllustrative: values["replace-illustrative"],
  });
  console.log(
    `drafted ${s.drafted}, stored ${s.stored} rows, skipped ${s.skippedExisting} that already have profiles, ${s.failed.length} failed`,
  );
  for (const f of s.failed.slice(0, 20)) console.error(`  ${f.ticker}: ${f.reason}`);
}
await close();
