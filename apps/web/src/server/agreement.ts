import { and, asc, eq, inArray } from "drizzle-orm";
import {
  blindReviews,
  companies,
  companyFactorExposures,
  factors,
  type Db,
} from "@portfolio-lab/db";
import { raterAgreement, type RatedCompany, type RaterAgreement } from "@portfolio-lab/finance";
import { GOLD_SET } from "@portfolio-lab/shared";

export interface DraftAgreement {
  goldSize: number;
  reviewers: string[];
  /** AI draft against the first blind human score of each company. */
  ai: RaterAgreement;
  /** First blind human score against the second, where two people scored the same company. A ceiling for the AI. */
  humans: RaterAgreement | null;
  /** One row per company-force cell, for the CSV export and the paper. */
  cells: { ticker: string; force: string; ai: number; human: number; reviewer: string }[];
}

const toScores = (rows: readonly { slug: string; magnitude: number; direction: number }[]) =>
  Object.fromEntries(rows.map((r) => [r.slug, r.magnitude * r.direction]));

/** Compares every blind human score with the AI draft that was hidden from the reviewer. */
export async function getDraftAgreement(
  db: Db,
  opts: { goldSet?: readonly string[]; resamples?: number } = {},
): Promise<DraftAgreement> {
  const goldSize = (opts.goldSet ?? GOLD_SET).length;
  const forces = (
    await db.select({ slug: factors.slug }).from(factors).orderBy(asc(factors.slug))
  ).map((f) => f.slug);
  const reviews = await db
    .select({
      companyId: blindReviews.companyId,
      ticker: companies.ticker,
      reviewer: blindReviews.reviewer,
      aiVersion: blindReviews.aiVersion,
      scores: blindReviews.scores,
    })
    .from(blindReviews)
    .innerJoin(companies, eq(companies.id, blindReviews.companyId))
    .orderBy(asc(companies.ticker), asc(blindReviews.createdAt), asc(blindReviews.id));

  const byCompany = new Map<number, typeof reviews>();
  for (const r of reviews) byCompany.set(r.companyId, [...(byCompany.get(r.companyId) ?? []), r]);

  const drafts = reviews.length
    ? await db
        .select({
          companyId: companyFactorExposures.companyId,
          version: companyFactorExposures.version,
          slug: factors.slug,
          magnitude: companyFactorExposures.magnitude,
          direction: companyFactorExposures.direction,
        })
        .from(companyFactorExposures)
        .innerJoin(factors, eq(factors.id, companyFactorExposures.factorId))
        .where(
          and(
            inArray(companyFactorExposures.companyId, [...byCompany.keys()]),
            inArray(companyFactorExposures.source, ["llm_seeded", "llm_updated"]),
          ),
        )
    : [];

  const vsAi: RatedCompany[] = [];
  const vsHuman: RatedCompany[] = [];
  const cells: DraftAgreement["cells"] = [];
  for (const [companyId, rs] of byCompany) {
    const first = rs[0]!;
    const ai = toScores(
      drafts.filter((d) => d.companyId === companyId && d.version === first.aiVersion),
    );
    const human = toScores(first.scores);
    vsAi.push({ ticker: first.ticker, ai, human });
    for (const f of forces)
      cells.push({
        ticker: first.ticker,
        force: f,
        ai: ai[f] ?? 0,
        human: human[f] ?? 0,
        reviewer: first.reviewer,
      });
    if (rs[1]) vsHuman.push({ ticker: first.ticker, ai: human, human: toScores(rs[1].scores) });
  }

  const resamples = opts.resamples ?? 2000;
  return {
    goldSize,
    reviewers: [...new Set(reviews.map((r) => r.reviewer))].sort(),
    ai: raterAgreement(vsAi, forces, { resamples }),
    humans: vsHuman.length ? raterAgreement(vsHuman, forces, { resamples }) : null,
    cells,
  };
}

export function agreementCsv(a: DraftAgreement): string {
  const lines = ["ticker,force,ai_score,human_score,reviewer"];
  for (const c of a.cells)
    lines.push([c.ticker, c.force, c.ai, c.human, JSON.stringify(c.reviewer)].join(","));
  return lines.join("\n") + "\n";
}
