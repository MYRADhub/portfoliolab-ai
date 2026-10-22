import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { companies, companyFactorExposures, factors, type Db } from "@portfolio-lab/db";
import { z } from "zod";
import { exposureProvenance, type Provenance } from "@/lib/provenance";
import { AppError } from "./errors";
import { env } from "./env";

const DRAFT_PREFIX = /^AI-drafted, not reviewed:\s*/;
export const MAX_REVIEW_ROWS = 12;

export function assertReviewer(req: Request): void {
  const expected = env().REVIEW_TOKEN;
  if (!expected) throw new AppError("not_found", "Not found");
  const given = Buffer.from(req.headers.get("x-review-token") ?? "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want))
    throw new AppError("forbidden", "Forbidden");
}

export type ReviewStatus = Provenance | "none";

export interface ReviewListItem {
  ticker: string;
  name: string;
  sector: string | null;
  status: ReviewStatus;
  forces: number;
}

function statusOf(rationales: (string | null)[]): ReviewStatus {
  if (rationales.length === 0) return "none";
  const kinds = rationales.map(exposureProvenance);
  if (kinds.includes("draft")) return "draft";
  if (kinds.includes("illustrative")) return "illustrative";
  return "reviewed";
}

async function currentRows(db: Db) {
  return db
    .select({
      companyId: companyFactorExposures.companyId,
      rationale: companyFactorExposures.rationale,
    })
    .from(companyFactorExposures)
    .where(isNull(companyFactorExposures.validTo));
}

export async function reviewSummary(db: Db) {
  const all = await db.select({ id: companies.id }).from(companies);
  const rows = await currentRows(db);
  const by = new Map<number, (string | null)[]>();
  for (const r of rows) by.set(r.companyId, [...(by.get(r.companyId) ?? []), r.rationale]);
  const counts: Record<ReviewStatus, number> = { draft: 0, illustrative: 0, reviewed: 0, none: 0 };
  for (const c of all) counts[statusOf(by.get(c.id) ?? [])]++;
  return { companies: all.length, ...counts };
}

export async function listForReview(
  db: Db,
  opts: { status?: ReviewStatus | "all"; q?: string; limit?: number },
): Promise<ReviewListItem[]> {
  const { status = "all", q = "", limit = 100 } = opts;
  const all = await db.select().from(companies).orderBy(asc(companies.ticker));
  const rows = await currentRows(db);
  const by = new Map<number, (string | null)[]>();
  for (const r of rows) by.set(r.companyId, [...(by.get(r.companyId) ?? []), r.rationale]);
  const term = q.trim().toLowerCase();
  return all
    .map((c) => {
      const r = by.get(c.id) ?? [];
      return {
        ticker: c.ticker,
        name: c.name,
        sector: c.sector,
        status: statusOf(r),
        forces: r.length,
      };
    })
    .filter(
      (c) =>
        (status === "all" || c.status === status) &&
        (!term || c.ticker.toLowerCase().startsWith(term) || c.name.toLowerCase().includes(term)),
    )
    .slice(0, limit);
}

export interface ReviewProfile {
  company: { ticker: string; name: string; sector: string | null; industry: string | null };
  status: ReviewStatus;
  version: number;
  reviewedBy: string | null;
  rows: {
    slug: string;
    magnitude: number;
    direction: number;
    confidence: number;
    rationale: string;
    provenance: Provenance;
  }[];
  forces: { slug: string; name: string; risesMeans: string | null }[];
}

async function findCompany(db: Db, ticker: string) {
  const [c] = await db.select().from(companies).where(eq(companies.ticker, ticker.toUpperCase()));
  if (!c) throw new AppError("not_found", "Company not found");
  return c;
}

export async function getReviewProfile(db: Db, ticker: string): Promise<ReviewProfile> {
  const c = await findCompany(db, ticker);
  const rows = await db
    .select({
      slug: factors.slug,
      magnitude: companyFactorExposures.magnitude,
      direction: companyFactorExposures.direction,
      confidence: companyFactorExposures.confidence,
      rationale: companyFactorExposures.rationale,
      version: companyFactorExposures.version,
      reviewedBy: companyFactorExposures.reviewedBy,
    })
    .from(companyFactorExposures)
    .innerJoin(factors, eq(factors.id, companyFactorExposures.factorId))
    .where(and(eq(companyFactorExposures.companyId, c.id), isNull(companyFactorExposures.validTo)));
  const forces = await db.select().from(factors).orderBy(asc(factors.name));
  return {
    company: { ticker: c.ticker, name: c.name, sector: c.sector, industry: c.industry },
    status: statusOf(rows.map((r) => r.rationale)),
    version: rows.reduce((m, r) => Math.max(m, r.version), 0),
    reviewedBy: rows.find((r) => r.reviewedBy)?.reviewedBy ?? null,
    rows: rows
      .map((r) => ({
        slug: r.slug,
        magnitude: r.magnitude,
        direction: r.direction,
        confidence: r.confidence,
        rationale: r.rationale ?? "",
        provenance: exposureProvenance(r.rationale),
      }))
      .sort((a, b) => b.magnitude - a.magnitude || a.slug.localeCompare(b.slug)),
    forces: forces.map((f) => ({ slug: f.slug, name: f.name, risesMeans: f.risesMeans })),
  };
}

export const saveSchema = z.object({
  reviewer: z.string().trim().min(2).max(80),
  rows: z
    .array(
      z.object({
        slug: z.string().max(60),
        magnitude: z.number().int().min(1).max(3),
        direction: z.union([z.literal(1), z.literal(-1)]),
        confidence: z.number().min(0).max(1),
        rationale: z.string().trim().min(1).max(300),
      }),
    )
    .max(MAX_REVIEW_ROWS),
});

/**
 * Replaces a company's current profile with the reviewer's version. The old rows are closed, not deleted, so every
 * earlier version stays in the table. Saved rows are marked manual and carry the reviewer's name and the time.
 */
export async function saveReviewedProfile(
  db: Db,
  ticker: string,
  input: z.infer<typeof saveSchema>,
) {
  const c = await findCompany(db, ticker);
  const known = new Map(
    (await db.select({ id: factors.id, slug: factors.slug }).from(factors)).map((f) => [
      f.slug,
      f.id,
    ]),
  );
  const seen = new Set<string>();
  for (const r of input.rows) {
    if (!known.has(r.slug)) throw new AppError("bad_request", `Unknown force: ${r.slug}`);
    if (seen.has(r.slug)) throw new AppError("bad_request", `Force listed twice: ${r.slug}`);
    seen.add(r.slug);
  }
  await db.transaction(async (tx) => {
    const [v] = await tx
      .select({ v: max(companyFactorExposures.version) })
      .from(companyFactorExposures)
      .where(eq(companyFactorExposures.companyId, c.id));
    const now = new Date();
    await tx
      .update(companyFactorExposures)
      .set({ validTo: now })
      .where(
        and(eq(companyFactorExposures.companyId, c.id), isNull(companyFactorExposures.validTo)),
      );
    if (input.rows.length === 0) return;
    await tx.insert(companyFactorExposures).values(
      input.rows.map((r) => ({
        companyId: c.id,
        factorId: known.get(r.slug)!,
        magnitude: r.magnitude,
        direction: r.direction,
        confidence: r.confidence,
        rationale: r.rationale.replace(DRAFT_PREFIX, ""),
        source: "manual" as const,
        reviewedBy: input.reviewer,
        reviewedAt: now,
        version: (v?.v ?? 0) + 1,
        validFrom: now,
      })),
    );
  });
  return getReviewProfile(db, ticker);
}
