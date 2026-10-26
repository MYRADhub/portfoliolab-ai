import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { companies, companyFactorExposures, factors, type Db } from "@portfolio-lab/db";
import { DEFAULT_MODEL } from "./classifier";

export const EXPOSURE_PROMPT_VERSION = "expo-v1";
export const MAX_DRAFT_EXPOSURES = 6;
/** Drafted confidence never exceeds this: a model's recollection of a business is not a measurement. */
export const MAX_DRAFT_CONFIDENCE = 0.8;
export const MIN_DRAFT_CONFIDENCE = 0.3;
export const DRAFT_LABEL = "AI-drafted, not reviewed:";
/** Rationale prefix written by the demo seed. Such rows are made up and may be replaced by a draft on request. */
export const ILLUSTRATIVE_LABEL = "Demo data";

export interface FactorInfo {
  slug: string;
  name: string;
  description: string;
  risesMeans: string | null;
}

export interface CompanyInfo {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
}

/** Shape asked of the model. Ranges are enforced afterwards by cleanDraft. */
export const draftSchema = z.object({
  exposures: z.array(
    z.object({
      factor: z.string(),
      magnitude: z.number().int(),
      direction: z.number().int(),
      confidence: z.number(),
      rationale: z.string(),
    }),
  ),
});
export type DraftOutput = z.infer<typeof draftSchema>;

export interface DraftedExposure {
  slug: string;
  magnitude: 1 | 2 | 3;
  direction: 1 | -1;
  confidence: number;
  rationale: string;
}

/** Stable across companies so it can be cached. */
export function buildExposurePrompt(list: readonly FactorInfo[]): string {
  const rows = list
    .map(
      (f) =>
        `- ${f.slug}: ${f.name}. ${f.description}${f.risesMeans ? ` When it rises: ${f.risesMeans}` : ""}`,
    )
    .join("\n");
  return `You draft hidden-exposure profiles for companies in an investment research tool. A hidden exposure is an economic force that moves a company's value, whatever its sector label says.

For each company choose the few forces from the list below that clearly matter to it, using only well-known, general facts about its business.

For every force give:
- magnitude: 1 (minor), 2 (meaningful) or 3 (a central driver of the company's value).
- direction: +1 if the company's value tends to rise when the force rises, -1 if it tends to fall.
- confidence: between 0.3 and 0.8. Use lower values for indirect or uncertain links.
- rationale: one plain sentence, at most 160 characters, naming the mechanism.

Rules:
- Include only forces with a clear mechanism. Usually 3 to 5, never more than ${MAX_DRAFT_EXPOSURES}. Fewer is better than guessing.
- Use the slugs exactly as written. Never invent a force.
- Do not state figures you are not sure of. These are judgments for a human to review, not measurements.

Forces:
${rows}`;
}

export function buildCompanyMessage(c: CompanyInfo): string {
  return `Company: ${c.name} (${c.ticker})\nSector: ${c.sector ?? "unknown"}\nIndustry: ${c.industry ?? "unknown"}`;
}

/** Applies the limits the API schema cannot express: known forces only, ranges, no duplicates, a cap on count. */
export function cleanDraft(raw: DraftOutput, slugs: ReadonlySet<string>): DraftedExposure[] {
  const best = new Map<string, DraftedExposure>();
  for (const e of raw.exposures) {
    if (!slugs.has(e.factor)) continue;
    if (e.magnitude < 1 || (e.direction !== 1 && e.direction !== -1)) continue;
    const rationale = e.rationale.trim().slice(0, 200);
    if (!rationale) continue;
    const row: DraftedExposure = {
      slug: e.factor,
      magnitude: Math.min(3, e.magnitude) as 1 | 2 | 3,
      direction: e.direction as 1 | -1,
      confidence: Math.min(
        MAX_DRAFT_CONFIDENCE,
        Math.max(
          MIN_DRAFT_CONFIDENCE,
          Number.isFinite(e.confidence) ? e.confidence : MIN_DRAFT_CONFIDENCE,
        ),
      ),
      rationale,
    };
    const prev = best.get(e.factor);
    if (!prev || row.magnitude > prev.magnitude) best.set(e.factor, row);
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        b.magnitude - a.magnitude || b.confidence - a.confidence || a.slug.localeCompare(b.slug),
    )
    .slice(0, MAX_DRAFT_EXPOSURES);
}

export interface ExposureDrafter {
  readonly model: string;
  /** Null when the model refused or its answer was unusable. */
  draft(company: CompanyInfo, list: readonly FactorInfo[]): Promise<DraftOutput | null>;
}

export class OpenAIExposureDrafter implements ExposureDrafter {
  constructor(
    private readonly client: OpenAI,
    readonly model: string = DEFAULT_MODEL,
  ) {}

  async draft(company: CompanyInfo, list: readonly FactorInfo[]): Promise<DraftOutput | null> {
    const response = await this.client.responses.parse({
      model: this.model,
      instructions: buildExposurePrompt(list),
      input: buildCompanyMessage(company),
      text: { format: zodTextFormat(draftSchema, "exposure_draft") },
    });
    if (response.status === "incomplete") return null;
    const parsed = draftSchema.safeParse(response.output_parsed);
    return parsed.success ? parsed.data : null;
  }
}

export async function loadFactorInfo(db: Db): Promise<FactorInfo[]> {
  const rows = await db.select().from(factors);
  return rows.map((f) => ({
    slug: f.slug,
    name: f.name,
    description: f.description,
    risesMeans: f.risesMeans,
  }));
}

export interface StoreSummary {
  drafted: number;
  stored: number;
  skippedExisting: number;
  failed: { ticker: string; reason: string }[];
}

/**
 * Drafts and stores profiles for companies that have none. Companies with any current exposure row (hand-made or
 * drafted) are never touched, so reviewed data cannot be overwritten. Rows are labelled as unreviewed drafts.
 *
 * With `replaceIllustrative`, companies whose current rows are all made-up demo rows are drafted too: the demo rows
 * are closed (kept as history) and the draft is stored as the next version. Reviewed and drafted rows stay untouched.
 */
export async function draftAndStore(
  db: Db,
  drafter: ExposureDrafter,
  opts: {
    tickers?: readonly string[];
    limit?: number;
    concurrency?: number;
    replaceIllustrative?: boolean;
  } = {},
): Promise<StoreSummary> {
  const list = await loadFactorInfo(db);
  const slugs = new Set(list.map((f) => f.slug));
  const factorId = new Map(
    (await db.select({ id: factors.id, slug: factors.slug }).from(factors)).map((f) => [
      f.slug,
      f.id,
    ]),
  );
  const all = await db.select().from(companies);
  const wanted = opts.tickers ? new Set(opts.tickers) : null;
  const pool = all.filter((c) => !wanted || wanted.has(c.ticker));
  const current = await db
    .select({ id: companyFactorExposures.companyId, rationale: companyFactorExposures.rationale })
    .from(companyFactorExposures)
    .where(
      and(
        isNull(companyFactorExposures.validTo),
        inArray(
          companyFactorExposures.companyId,
          pool.map((c) => c.id),
        ),
      ),
    );
  const have = new Set(current.map((r) => r.id));
  // A company is replaceable only when every current row is a demo row.
  const replaceable = new Set(opts.replaceIllustrative ? have : []);
  for (const r of current)
    if (!r.rationale?.startsWith(ILLUSTRATIVE_LABEL)) replaceable.delete(r.id);
  const todo = pool
    .filter((c) => !have.has(c.id) || replaceable.has(c.id))
    .slice(0, opts.limit ?? Infinity);
  const summary: StoreSummary = {
    drafted: 0,
    stored: 0,
    skippedExisting: pool.length - todo.length,
    failed: [],
  };

  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const c = todo[next++]!;
      try {
        const raw = await drafter.draft(
          { ticker: c.ticker, name: c.name, sector: c.sector, industry: c.industry },
          list,
        );
        if (!raw) {
          summary.failed.push({ ticker: c.ticker, reason: "no usable answer" });
          continue;
        }
        const rows = cleanDraft(raw, slugs);
        summary.drafted++;
        if (rows.length === 0) {
          summary.failed.push({ ticker: c.ticker, reason: "no valid exposures" });
          continue;
        }
        await db.transaction(async (tx) => {
          let version = 1;
          if (replaceable.has(c.id)) {
            const [v] = await tx
              .select({ v: max(companyFactorExposures.version) })
              .from(companyFactorExposures)
              .where(eq(companyFactorExposures.companyId, c.id));
            version = (v?.v ?? 0) + 1;
            await tx
              .update(companyFactorExposures)
              .set({ validTo: new Date() })
              .where(
                and(
                  eq(companyFactorExposures.companyId, c.id),
                  isNull(companyFactorExposures.validTo),
                ),
              );
          }
          await tx
            .insert(companyFactorExposures)
            .values(
              rows.map((r) => ({
                companyId: c.id,
                factorId: factorId.get(r.slug)!,
                magnitude: r.magnitude,
                direction: r.direction,
                confidence: r.confidence,
                rationale: `${DRAFT_LABEL} ${r.rationale}`,
                source: "llm_seeded" as const,
                version,
              })),
            )
            .onConflictDoNothing();
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

export interface Agreement {
  /** Cosine similarity of the two signed profiles; null when either is empty. */
  cosine: number | null;
  /** Forces both profiles contain. */
  shared: number;
  /** Share of shared forces where the direction matches; null when nothing is shared. */
  directionAgreement: number | null;
  /** Mean absolute difference in magnitude over shared forces; null when nothing is shared. */
  meanMagnitudeError: number | null;
  /** Share of the reference's strong forces (magnitude 2 or more) that the draft also contains. */
  recallStrong: number | null;
  /** Share of the draft's strong forces that appear anywhere in the reference. */
  precisionStrong: number | null;
}

/** How closely a drafted profile matches a reference profile, both given as signed magnitudes (-3 to +3) by force. */
export function exposureAgreement(
  draft: Readonly<Record<string, number>>,
  reference: Readonly<Record<string, number>>,
): Agreement {
  const dk = Object.keys(draft).filter((k) => draft[k] !== 0);
  const rk = Object.keys(reference).filter((k) => reference[k] !== 0);
  const shared = dk.filter((k) => k in reference && reference[k] !== 0);
  let dot = 0;
  let nd = 0;
  let nr = 0;
  for (const k of dk) {
    nd += draft[k]! ** 2;
    dot += draft[k]! * (reference[k] ?? 0);
  }
  for (const k of rk) nr += reference[k]! ** 2;
  const strong = (v: Readonly<Record<string, number>>) =>
    Object.keys(v).filter((k) => Math.abs(v[k]!) >= 2);
  const refStrong = strong(reference);
  const draftStrong = strong(draft);
  return {
    cosine: nd === 0 || nr === 0 ? null : dot / Math.sqrt(nd * nr),
    shared: shared.length,
    directionAgreement: shared.length
      ? shared.filter((k) => Math.sign(draft[k]!) === Math.sign(reference[k]!)).length /
        shared.length
      : null,
    meanMagnitudeError: shared.length
      ? shared.reduce((a, k) => a + Math.abs(Math.abs(draft[k]!) - Math.abs(reference[k]!)), 0) /
        shared.length
      : null,
    recallStrong: refStrong.length
      ? refStrong.filter((k) => draft[k] !== undefined && draft[k] !== 0).length / refStrong.length
      : null,
    precisionStrong: draftStrong.length
      ? draftStrong.filter((k) => reference[k] !== undefined && reference[k] !== 0).length /
        draftStrong.length
      : null,
  };
}

/** Reads the current signed profiles of the given companies from the database, by force slug. */
export async function loadProfiles(
  db: Db,
  tickers: readonly string[],
): Promise<Map<string, Record<string, number>>> {
  const rows = await db
    .select({
      ticker: companies.ticker,
      slug: factors.slug,
      magnitude: companyFactorExposures.magnitude,
      direction: companyFactorExposures.direction,
    })
    .from(companyFactorExposures)
    .innerJoin(companies, eq(companies.id, companyFactorExposures.companyId))
    .innerJoin(factors, eq(factors.id, companyFactorExposures.factorId))
    .where(and(isNull(companyFactorExposures.validTo), inArray(companies.ticker, [...tickers])));
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const p = out.get(r.ticker) ?? {};
    p[r.slug] = r.magnitude * r.direction;
    out.set(r.ticker, p);
  }
  return out;
}
