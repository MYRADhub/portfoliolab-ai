import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { MIN_QUOTE_WORDS, normalizeForQuote } from "@portfolio-lab/data";
import { companies, companyFactorExposures, factors, type Db } from "@portfolio-lab/db";
import { DEFAULT_MODEL } from "./classifier";
import {
  DRAFT_LABEL,
  ILLUSTRATIVE_LABEL,
  loadFactorInfo,
  MAX_DRAFT_CONFIDENCE,
  MAX_DRAFT_EXPOSURES,
  MIN_DRAFT_CONFIDENCE,
  type CompanyInfo,
  type FactorInfo,
} from "./exposures";

/** Drafts grounded in the company's own annual report, each score backed by a quote that is checked to be there. */
export const GROUNDED_PROMPT_VERSION = "expo-v2";
export const DEFAULT_RUNS = 5;
/** Fewer usable runs than this and the company is not stored: a median of one or two answers says little. */
export const MIN_USABLE_RUNS = 3;
export const MAX_EVIDENCE_CHARS = 300;

export interface AnnualReport {
  url: string;
  filingDate: string;
  /** The fiscal period end the report covers, when known. */
  reportDate: string | null;
  business: string;
  risks: string;
}

export const groundedSchema = z.object({
  exposures: z.array(
    z.object({
      factor: z.string(),
      magnitude: z.number().int(),
      direction: z.number().int(),
      rationale: z.string(),
      evidence: z.string(),
    }),
  ),
});
export type GroundedOutput = z.infer<typeof groundedSchema>;

export interface RunUsage {
  input: number;
  cachedInput: number;
  output: number;
}

/** Stable across companies so it can be cached. */
export function buildGroundedPrompt(list: readonly FactorInfo[]): string {
  const rows = list
    .map(
      (f) =>
        `- ${f.slug}: ${f.name}. ${f.description}${f.risesMeans ? ` When it rises: ${f.risesMeans}` : ""}`,
    )
    .join("\n");
  return `You draft hidden-exposure profiles for companies in an investment research tool. A hidden exposure is an economic force that moves a company's value, whatever its sector label says.

You are given excerpts from one company's annual report (Form 10-K): its business description and its risk factors. Base every judgment ONLY on these excerpts. Do not use anything you remember about the company, its later results or its share price.

Choose the few forces from the list below that the excerpts show clearly matter to the company. For every force give:
- magnitude: 1 (minor), 2 (meaningful) or 3 (a central driver of the company's value).
- direction: +1 if the company's value tends to rise when the force rises, -1 if it tends to fall.
- rationale: one plain sentence, at most 160 characters, naming the mechanism.
- evidence: a passage copied word for word from the excerpts, at least 6 words and at most ${MAX_EVIDENCE_CHARS} characters, that shows the mechanism. Copy it exactly; never paraphrase or join separate passages.

Rules:
- Include only forces the excerpts support. Usually 3 to 5, never more than ${MAX_DRAFT_EXPOSURES}. If no passage supports a force, leave it out.
- Use the slugs exactly as written. Never invent a force.
- These are judgments for a human to review, not measurements.

Forces:
${rows}`;
}

export function buildReportMessage(c: CompanyInfo, r: AnnualReport): string {
  return `Company: ${c.name} (${c.ticker})
Sector: ${c.sector ?? "unknown"}
Annual report filed ${r.filingDate}${r.reportDate ? ` for the fiscal year ending ${r.reportDate}` : ""}.

=== Item 1. Business (excerpt) ===
${r.business || "(not found)"}

=== Item 1A. Risk Factors (excerpt) ===
${r.risks || "(not found)"}`;
}

export interface GroundedDrafter {
  readonly model: string;
  /** Null when the model refused or its answer was unusable. */
  draft(
    company: CompanyInfo,
    list: readonly FactorInfo[],
    report: AnnualReport,
  ): Promise<{ output: GroundedOutput | null; usage: RunUsage }>;
}

export class OpenAIGroundedDrafter implements GroundedDrafter {
  constructor(
    private readonly client: OpenAI,
    readonly model: string = DEFAULT_MODEL,
  ) {}

  async draft(company: CompanyInfo, list: readonly FactorInfo[], report: AnnualReport) {
    const response = await this.client.responses.parse({
      model: this.model,
      instructions: buildGroundedPrompt(list),
      input: buildReportMessage(company, report),
      text: { format: zodTextFormat(groundedSchema, "grounded_exposure_draft") },
    });
    const usage: RunUsage = {
      input: response.usage?.input_tokens ?? 0,
      cachedInput: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      output: response.usage?.output_tokens ?? 0,
    };
    if (response.status === "incomplete") return { output: null, usage };
    const parsed = groundedSchema.safeParse(response.output_parsed);
    return { output: parsed.success ? parsed.data : null, usage };
  }
}

export interface RunScore {
  signed: number;
  rationale: string;
  evidence: string;
}

export interface CheckedRun {
  scores: Map<string, RunScore>;
  /** Exposures dropped because their evidence was not found in the report, or was too short. */
  unverified: number;
}

/**
 * Keeps the exposures of one run that name a known force, have a valid score and quote the report word for word.
 * `normalizedSource` is the report text passed through normalizeForQuote once, outside the loop.
 */
export function checkRun(
  raw: GroundedOutput,
  slugs: ReadonlySet<string>,
  normalizedSource: string,
): CheckedRun {
  const scores = new Map<string, RunScore>();
  let unverified = 0;
  for (const e of raw.exposures) {
    if (!slugs.has(e.factor)) continue;
    if (e.magnitude < 1 || (e.direction !== 1 && e.direction !== -1)) continue;
    const rationale = e.rationale.trim().slice(0, 200);
    const evidence = e.evidence.trim().slice(0, MAX_EVIDENCE_CHARS);
    const q = normalizeForQuote(evidence);
    if (!rationale) continue;
    if (q.split(" ").length < MIN_QUOTE_WORDS || !normalizedSource.includes(q)) {
      unverified++;
      continue;
    }
    const signed = Math.min(3, e.magnitude) * e.direction;
    const prev = scores.get(e.factor);
    if (!prev || Math.abs(signed) > Math.abs(prev.signed))
      scores.set(e.factor, { signed, rationale, evidence });
  }
  return { scores, unverified };
}

export interface GroundedExposure {
  slug: string;
  magnitude: 1 | 2 | 3;
  direction: 1 | -1;
  /** Share of usable runs that gave exactly this score. */
  stability: number;
  confidence: number;
  rationale: string;
  evidence: string;
}

/** The middle value; with an even count, whichever of the two middle values is closer to zero, so it is always one of the inputs. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  if (s.length % 2) return s[m]!;
  return Math.abs(s[m - 1]!) <= Math.abs(s[m]!) ? s[m - 1]! : s[m]!;
}

/**
 * Combines repeated runs into one profile. For each force the score is the median over all runs, counting a run
 * that left the force out as 0, so a force must appear in most runs to survive. Stability is the share of runs that
 * gave exactly the median; confidence rises with it from 0.3 to 0.8. The wording comes from the first run that gave
 * the median score. With an even number of runs the middle value closer to zero is taken.
 */
export function combineRuns(runs: readonly CheckedRun[]): GroundedExposure[] {
  if (runs.length === 0) return [];
  const slugs = new Set(runs.flatMap((r) => [...r.scores.keys()]));
  const out: GroundedExposure[] = [];
  for (const slug of slugs) {
    const values = runs.map((r) => r.scores.get(slug)?.signed ?? 0);
    const med = median(values);
    if (med === 0) continue;
    const stability = values.filter((v) => v === med).length / runs.length;
    const source = runs.map((r) => r.scores.get(slug)).find((s) => s?.signed === med)!;
    out.push({
      slug,
      magnitude: Math.abs(med) as 1 | 2 | 3,
      direction: Math.sign(med) as 1 | -1,
      stability,
      confidence: MIN_DRAFT_CONFIDENCE + (MAX_DRAFT_CONFIDENCE - MIN_DRAFT_CONFIDENCE) * stability,
      rationale: source.rationale,
      evidence: source.evidence,
    });
  }
  return out
    .sort(
      (a, b) =>
        b.magnitude - a.magnitude || b.stability - a.stability || a.slug.localeCompare(b.slug),
    )
    .slice(0, MAX_DRAFT_EXPOSURES);
}

export interface ReportSource {
  /** The annual report to draft from, or null when none is available before the cutoff. */
  get(company: { ticker: string; cik: string | null }): Promise<AnnualReport | null>;
}

export interface GroundedSummary {
  drafted: number;
  stored: number;
  /** Companies left alone: reviewed by a person, or already grounded. */
  skipped: number;
  unverified: number;
  usage: RunUsage;
  failed: { ticker: string; reason: string }[];
}

/**
 * Drafts profiles from each company's annual report, `runs` times, and stores the combined result as a new version.
 * A company is drafted when it has no profile, or when every current row is an AI draft or demo row that is not yet
 * grounded in a report. Rows written or edited by a person are never touched. Replaced rows are closed, not deleted.
 */
export async function draftGroundedAndStore(
  db: Db,
  drafter: GroundedDrafter,
  reports: ReportSource,
  opts: { tickers?: readonly string[]; limit?: number; runs?: number; concurrency?: number } = {},
): Promise<GroundedSummary> {
  const runs = Math.max(1, opts.runs ?? DEFAULT_RUNS);
  const list = await loadFactorInfo(db);
  const slugs = new Set(list.map((f) => f.slug));
  const factorId = new Map(
    (await db.select({ id: factors.id, slug: factors.slug }).from(factors)).map((f) => [
      f.slug,
      f.id,
    ]),
  );
  const wanted = opts.tickers ? new Set(opts.tickers) : null;
  const pool = (await db.select().from(companies)).filter((c) => !wanted || wanted.has(c.ticker));
  const current = pool.length
    ? await db
        .select({
          id: companyFactorExposures.companyId,
          rationale: companyFactorExposures.rationale,
          evidenceQuote: companyFactorExposures.evidenceQuote,
        })
        .from(companyFactorExposures)
        .where(
          and(
            isNull(companyFactorExposures.validTo),
            inArray(
              companyFactorExposures.companyId,
              pool.map((c) => c.id),
            ),
          ),
        )
    : [];
  const keep = new Set<number>();
  for (const r of current) {
    const machine =
      r.rationale?.startsWith(DRAFT_LABEL) || r.rationale?.startsWith(ILLUSTRATIVE_LABEL);
    if (!machine || r.evidenceQuote) keep.add(r.id);
  }
  const todo = pool.filter((c) => !keep.has(c.id)).slice(0, opts.limit ?? Infinity);
  const summary: GroundedSummary = {
    drafted: 0,
    stored: 0,
    skipped: pool.length - todo.length,
    unverified: 0,
    usage: { input: 0, cachedInput: 0, output: 0 },
    failed: [],
  };
  const addUsage = (u: RunUsage) => {
    summary.usage.input += u.input;
    summary.usage.cachedInput += u.cachedInput;
    summary.usage.output += u.output;
  };

  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const c = todo[next++]!;
      try {
        const report = await reports.get({ ticker: c.ticker, cik: c.cik });
        if (!report || (!report.business && !report.risks)) {
          summary.failed.push({ ticker: c.ticker, reason: "no annual report text" });
          continue;
        }
        const info = { ticker: c.ticker, name: c.name, sector: c.sector, industry: c.industry };
        const source = normalizeForQuote(`${report.business}\n${report.risks}`);
        const one = async () => {
          const r = await drafter.draft(info, list, report);
          addUsage(r.usage);
          return r.output ? checkRun(r.output, slugs, source) : null;
        };
        // The first run warms the prompt cache, so the rest reuse the long report prefix at a lower price.
        const first = await one();
        const rest = await Promise.all(Array.from({ length: runs - 1 }, one));
        const usable = [first, ...rest].filter((r): r is CheckedRun => r !== null);
        summary.unverified += usable.reduce((s, r) => s + r.unverified, 0);
        if (usable.length < Math.min(runs, MIN_USABLE_RUNS)) {
          summary.failed.push({ ticker: c.ticker, reason: `only ${usable.length} usable runs` });
          continue;
        }
        const rows = combineRuns(usable);
        summary.drafted++;
        if (rows.length === 0) {
          summary.failed.push({ ticker: c.ticker, reason: "no exposure survived the checks" });
          continue;
        }
        await db.transaction(async (tx) => {
          const [v] = await tx
            .select({ v: max(companyFactorExposures.version) })
            .from(companyFactorExposures)
            .where(eq(companyFactorExposures.companyId, c.id));
          await tx
            .update(companyFactorExposures)
            .set({ validTo: new Date() })
            .where(
              and(
                eq(companyFactorExposures.companyId, c.id),
                isNull(companyFactorExposures.validTo),
              ),
            );
          await tx.insert(companyFactorExposures).values(
            rows.map((r) => ({
              companyId: c.id,
              factorId: factorId.get(r.slug)!,
              magnitude: r.magnitude,
              direction: r.direction,
              confidence: r.confidence,
              stability: r.stability,
              rationale: `${DRAFT_LABEL} ${r.rationale}`,
              evidenceQuote: r.evidence,
              evidenceUrls: [report.url],
              source: "llm_seeded" as const,
              version: (v?.v ?? 0) + 1,
            })),
          );
        });
        summary.stored += rows.length;
      } catch (e) {
        summary.failed.push({
          ticker: c.ticker,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return summary;
}
