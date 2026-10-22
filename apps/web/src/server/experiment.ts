import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, asc, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  companies,
  companyFactorExposures,
  EXPERIMENT_EVENT_TYPES,
  experimentEvents,
  experimentParticipants,
  experimentResponses,
  experimentSubmissions,
  factors,
  pricesDaily,
  type Db,
} from "@portfolio-lab/db";
import {
  annualizedVolatility,
  assignArm,
  averagePairwise,
  commonDates,
  compareArms,
  concentration,
  correlationMatrix,
  dailyReturns,
  factorConcentration,
  factorLoadings,
  portfolioReturns,
  requiredPerArm,
  type Arm,
} from "@portfolio-lab/finance";
import { z } from "zod";
import { AppError } from "./errors";
import { env } from "./env";
import { toCsv } from "./csv";
import { monthsAgo } from "./portfolio-data";

export const EXPERIMENT_COOKIE = "pl_exp";
export const CONSENT_VERSION = "v1";
export const MIN_HOLDINGS = 5;
export const MAX_HOLDINGS = 10;
export const MIN_WEIGHT_PCT = 1;
const MIN_COMMON_DAYS = 120;

export const experimentEnabled = () => env().EXPERIMENT_ENABLED === "1";

export function assertEnabled(): void {
  if (!experimentEnabled() || !env().EXPERIMENT_ADMIN_TOKEN)
    throw new AppError("not_found", "Not found");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Participant {
  id: string;
  arm: Arm;
  experience: string;
  completed: boolean;
}

/** The cookie holds the participant id and an HMAC of it, so an edited or invented id is rejected. */
export function signParticipantId(id: string): string {
  const key = env().EXPERIMENT_ADMIN_TOKEN ?? "";
  return `${id}.${createHmac("sha256", key).update(id).digest("hex")}`;
}

export function readParticipantCookie(value: string | undefined): string | null {
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig || !UUID_RE.test(id)) return null;
  const want = Buffer.from(signParticipantId(id).split(".")[1]!);
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want) ? id : null;
}

/** The participant named by the study cookie, or 401. */
export async function requireParticipant(db: Db): Promise<Participant> {
  const value = readParticipantCookie((await cookies()).get(EXPERIMENT_COOKIE)?.value);
  if (value) {
    const [p] = await db
      .select()
      .from(experimentParticipants)
      .where(eq(experimentParticipants.id, value));
    if (p)
      return {
        id: p.id,
        arm: p.arm as Arm,
        experience: p.experience,
        completed: p.completedAt !== null,
      };
  }
  throw new AppError("unauthorized", "You are not enrolled in the study");
}

export const questionnaireSchema = z.object({
  perceivedDiversification: z.number().int().min(1).max(7),
  confidence: z.number().int().min(1).max(7),
});
export type Questionnaire = z.infer<typeof questionnaireSchema>;

export const enrollSchema = z.object({
  consent: z.literal(true),
  experience: z.enum(["novice", "intermediate", "expert"]),
  pre: questionnaireSchema,
});

/** Randomizes within the experience stratum and records consent plus the pre-task answers, atomically. */
export async function enroll(
  db: Db,
  input: z.infer<typeof enrollSchema>,
  rand: () => number = Math.random,
): Promise<Participant> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('experiment_enroll'))`);
    const rows = await tx
      .select({ arm: experimentParticipants.arm, n: count() })
      .from(experimentParticipants)
      .where(eq(experimentParticipants.experience, input.experience))
      .groupBy(experimentParticipants.arm);
    const counts = {
      control: rows.find((r) => r.arm === "control")?.n ?? 0,
      treatment: rows.find((r) => r.arm === "treatment")?.n ?? 0,
    };
    const arm = assignArm(counts, rand());
    const [p] = await tx
      .insert(experimentParticipants)
      .values({ arm, experience: input.experience, consentVersion: CONSENT_VERSION })
      .returning();
    await tx
      .insert(experimentResponses)
      .values({ participantId: p!.id, phase: "pre", ...input.pre });
    await tx
      .insert(experimentEvents)
      .values({ participantId: p!.id, type: "enrolled", payload: { arm } });
    return { id: p!.id, arm, experience: input.experience, completed: false };
  });
}

export interface UniverseItem {
  ticker: string;
  name: string;
  sector: string;
  /** Annualized volatility over the last year. */
  volatility: number | null;
  /** Treatment arm only: signed exposure (-3 to +3) per factor name. */
  exposures?: { factor: string; signed: number }[];
}

interface Profile {
  ticker: string;
  name: string;
  sector: string;
  exposures: Record<string, number>;
  factorNames: Record<string, string>;
}

/** Tickers the study is limited to, from EXPERIMENT_UNIVERSE; null means every company with exposure data. */
function configuredUniverse(): string[] | null {
  const raw = env().EXPERIMENT_UNIVERSE;
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  return list.length ? list : null;
}

async function loadProfiles(db: Db, tickers?: readonly string[]): Promise<Profile[]> {
  const rows = await db
    .select({
      ticker: companies.ticker,
      name: companies.name,
      sector: companies.sector,
      slug: factors.slug,
      factorName: factors.name,
      magnitude: companyFactorExposures.magnitude,
      direction: companyFactorExposures.direction,
    })
    .from(companyFactorExposures)
    .innerJoin(companies, eq(companies.id, companyFactorExposures.companyId))
    .innerJoin(factors, eq(factors.id, companyFactorExposures.factorId))
    .where(
      and(
        isNull(companyFactorExposures.validTo),
        tickers ? inArray(companies.ticker, [...tickers]) : undefined,
        !tickers && configuredUniverse()
          ? inArray(companies.ticker, configuredUniverse()!)
          : undefined,
      ),
    )
    .orderBy(asc(companies.ticker));
  const map = new Map<string, Profile>();
  for (const r of rows) {
    const p = map.get(r.ticker) ?? {
      ticker: r.ticker,
      name: r.name,
      sector: r.sector ?? "Unclassified",
      exposures: {},
      factorNames: {},
    };
    p.exposures[r.slug] = r.magnitude * r.direction;
    p.factorNames[r.slug] = r.factorName;
    map.set(r.ticker, p);
  }
  return [...map.values()];
}

async function loadReturns(db: Db, tickers: readonly string[], now: Date) {
  const rows = await db
    .select({ ticker: companies.ticker, date: pricesDaily.date, adjClose: pricesDaily.adjClose })
    .from(pricesDaily)
    .innerJoin(companies, eq(companies.id, pricesDaily.companyId))
    .where(and(inArray(companies.ticker, [...tickers]), gte(pricesDaily.date, monthsAgo(now, 12))))
    .orderBy(asc(companies.ticker), asc(pricesDaily.date));
  const series = new Map<string, { date: string; adjClose: number }[]>();
  for (const r of rows) series.set(r.ticker, [...(series.get(r.ticker) ?? []), r]);
  return series;
}

/** The fixed set of companies participants choose from, with arm-appropriate information. */
export async function getUniverse(db: Db, arm: Arm, now = new Date()): Promise<UniverseItem[]> {
  const profiles = await loadProfiles(db);
  const series = await loadReturns(
    db,
    profiles.map((p) => p.ticker),
    now,
  );
  return profiles.map((p) => {
    const s = series.get(p.ticker) ?? [];
    const vol =
      s.length >= 60
        ? annualizedVolatility(
            dailyReturns(
              s,
              s.map((x) => x.date),
            ),
          )
        : null;
    return {
      ticker: p.ticker,
      name: p.name,
      sector: p.sector,
      volatility: vol,
      ...(arm === "treatment"
        ? {
            exposures: Object.entries(p.exposures)
              .filter(([, v]) => v !== 0)
              .map(([slug, signed]) => ({ factor: p.factorNames[slug]!, signed })),
          }
        : {}),
    };
  });
}

export const selectionSchema = z.object({
  holdings: z
    .array(z.object({ ticker: z.string().regex(/^[A-Z.\-]{1,10}$/), weightPct: z.number() }))
    .max(MAX_HOLDINGS),
});
export type Selection = z.infer<typeof selectionSchema>["holdings"];

export function validateSelection(holdings: Selection, universe: ReadonlySet<string>): void {
  if (holdings.length < MIN_HOLDINGS || holdings.length > MAX_HOLDINGS)
    throw new AppError("bad_request", `Choose ${MIN_HOLDINGS} to ${MAX_HOLDINGS} companies`);
  if (new Set(holdings.map((h) => h.ticker)).size !== holdings.length)
    throw new AppError("bad_request", "Each company can appear once");
  for (const h of holdings) {
    if (!universe.has(h.ticker))
      throw new AppError("bad_request", `${h.ticker} is not in the study universe`);
    if (!(h.weightPct >= MIN_WEIGHT_PCT))
      throw new AppError("bad_request", `Each weight must be at least ${MIN_WEIGHT_PCT}%`);
  }
  const total = holdings.reduce((a, h) => a + h.weightPct, 0);
  if (Math.abs(total - 100) > 0.01)
    throw new AppError("bad_request", "Weights must add up to 100%");
}

export interface PortfolioMetrics {
  sectors: { sector: string; weight: number }[];
  effectiveSectors: number;
  volatility: number;
  averageCorrelation: number | null;
  /** Hidden-exposure measures. Computed for every participant (the outcome) but shown to the treatment arm only. */
  factor: {
    factorHhi: number | null;
    effectiveFactors: number | null;
    topFactorShare: number | null;
    loadings: { factor: string; net: number; share: number }[];
  };
}

export async function computeMetrics(
  db: Db,
  holdings: Selection,
  now = new Date(),
): Promise<PortfolioMetrics> {
  const tickers = holdings.map((h) => h.ticker);
  const profiles = await loadProfiles(db, tickers);
  const byTicker = new Map(profiles.map((p) => [p.ticker, p]));
  const series = await loadReturns(db, tickers, now);
  const dates = commonDates(tickers.map((t) => series.get(t) ?? []));
  if (dates.length < MIN_COMMON_DAYS)
    throw new AppError("bad_request", "Not enough shared price history for these companies");
  const weights = holdings.map((h) => h.weightPct / 100);
  const rets = tickers.map((t) => dailyReturns(series.get(t)!, dates));
  const portRets = portfolioReturns(weights, rets);

  const sectorWeights = new Map<string, number>();
  holdings.forEach((h, i) => {
    const s = byTicker.get(h.ticker)?.sector ?? "Unclassified";
    sectorWeights.set(s, (sectorWeights.get(s) ?? 0) + weights[i]!);
  });

  const hx = holdings.map((h, i) => ({
    ticker: h.ticker,
    weight: weights[i]!,
    exposures: byTicker.get(h.ticker)?.exposures ?? {},
  }));
  const loadings = factorLoadings(hx);
  const conc = factorConcentration(loadings);
  const names = new Map(profiles.flatMap((p) => Object.entries(p.factorNames)));
  const share = new Map(conc.shares.map((s) => [s.slug, s.share]));

  return {
    sectors: [...sectorWeights.entries()]
      .map(([sector, weight]) => ({ sector, weight }))
      .sort((a, b) => b.weight - a.weight || a.sector.localeCompare(b.sector)),
    effectiveSectors: concentration([...sectorWeights.values()]).effectiveN,
    volatility: annualizedVolatility(portRets),
    averageCorrelation: averagePairwise(correlationMatrix(rets)),
    factor: {
      factorHhi: conc.hhi,
      effectiveFactors: conc.effectiveFactors,
      topFactorShare: conc.topShare,
      loadings: loadings.map((l) => ({
        factor: names.get(l.slug) ?? l.slug,
        net: l.net,
        share: share.get(l.slug) ?? 0,
      })),
    },
  };
}

/** What a participant may see about their current selection. The control arm never receives hidden-exposure fields. */
export function viewFor(arm: Arm, m: PortfolioMetrics) {
  const { factor, ...common } = m;
  return arm === "treatment" ? { ...common, factor } : common;
}

export async function logEvent(db: Db, participantId: string, type: string, payload?: unknown) {
  await db.insert(experimentEvents).values({ participantId, type, payload: payload ?? null });
}

export const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(EXPERIMENT_EVENT_TYPES),
        payload: z
          .record(z.string().max(40), z.union([z.string().max(100), z.number(), z.boolean()]))
          .optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const submitSchema = z.object({
  holdings: selectionSchema.shape.holdings,
  post: questionnaireSchema,
});

/** Stores the final portfolio, its outcome measures and the post-task answers. A participant can submit once. */
export async function submit(
  db: Db,
  p: Participant,
  input: z.infer<typeof submitSchema>,
  now = new Date(),
) {
  if (p.completed) throw new AppError("conflict", "You have already submitted");
  const universe = new Set((await loadProfiles(db)).map((x) => x.ticker));
  validateSelection(input.holdings, universe);
  const m = await computeMetrics(db, input.holdings, now);
  if (m.factor.factorHhi === null)
    throw new AppError("bad_request", "These companies have no exposure data");
  await db.transaction(async (tx) => {
    await tx.insert(experimentSubmissions).values({
      participantId: p.id,
      holdings: input.holdings,
      nHoldings: input.holdings.length,
      factorHhi: m.factor.factorHhi!,
      effectiveFactors: m.factor.effectiveFactors!,
      effectiveSectors: m.effectiveSectors,
      topFactorShare: m.factor.topFactorShare!,
    });
    await tx
      .insert(experimentResponses)
      .values({ participantId: p.id, phase: "post", ...input.post });
    await tx
      .update(experimentParticipants)
      .set({ completedAt: new Date() })
      .where(eq(experimentParticipants.id, p.id));
    await tx
      .insert(experimentEvents)
      .values({ participantId: p.id, type: "submitted", payload: { n: input.holdings.length } });
  });
}

/** Withdrawal deletes everything stored about the participant. */
export async function withdraw(db: Db, participantId: string) {
  await db.delete(experimentParticipants).where(eq(experimentParticipants.id, participantId));
}

export { toCsv };

export function assertAdmin(req: Request): void {
  const expected = env().EXPERIMENT_ADMIN_TOKEN;
  if (!experimentEnabled() || !expected) throw new AppError("not_found", "Not found");
  const given = Buffer.from(req.headers.get("x-admin-token") ?? "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want))
    throw new AppError("forbidden", "Forbidden");
}

interface ExportRow {
  participant_id: string;
  arm: string;
  experience: string;
  consent_version: string;
  completed: boolean;
  pre_perceived_diversification: number | null;
  pre_confidence: number | null;
  post_perceived_diversification: number | null;
  post_confidence: number | null;
  n_holdings: number | null;
  factor_hhi: number | null;
  effective_factors: number | null;
  effective_sectors: number | null;
  top_factor_share: number | null;
  n_events: number;
  holdings: string | null;
}

export async function exportRows(db: Db): Promise<ExportRow[]> {
  const ps = await db
    .select()
    .from(experimentParticipants)
    .orderBy(asc(experimentParticipants.consentedAt));
  const rs = await db.select().from(experimentResponses);
  const ss = await db.select().from(experimentSubmissions);
  const es = await db
    .select({ id: experimentEvents.participantId, n: count() })
    .from(experimentEvents)
    .groupBy(experimentEvents.participantId);
  return ps.map((p) => {
    const pre = rs.find((r) => r.participantId === p.id && r.phase === "pre");
    const post = rs.find((r) => r.participantId === p.id && r.phase === "post");
    const sub = ss.find((s) => s.participantId === p.id);
    return {
      participant_id: p.id,
      arm: p.arm,
      experience: p.experience,
      consent_version: p.consentVersion,
      completed: p.completedAt !== null,
      pre_perceived_diversification: pre?.perceivedDiversification ?? null,
      pre_confidence: pre?.confidence ?? null,
      post_perceived_diversification: post?.perceivedDiversification ?? null,
      post_confidence: post?.confidence ?? null,
      n_holdings: sub?.nHoldings ?? null,
      factor_hhi: sub?.factorHhi ?? null,
      effective_factors: sub?.effectiveFactors ?? null,
      effective_sectors: sub?.effectiveSectors ?? null,
      top_factor_share: sub?.topFactorShare ?? null,
      n_events: es.find((e) => e.id === p.id)?.n ?? 0,
      holdings: sub
        ? (sub.holdings as { ticker: string; weightPct: number }[])
            .map((h) => `${h.ticker}:${h.weightPct}`)
            .join("|")
        : null,
    };
  });
}

export async function analysis(db: Db) {
  const rows = (await exportRows(db)).filter((r) => r.completed);
  const pick = (arm: string, f: (r: ExportRow) => number | null) =>
    rows
      .filter((r) => r.arm === arm)
      .map(f)
      .filter((v): v is number => v !== null);
  const outcome = (name: string, f: (r: ExportRow) => number | null) => ({
    name,
    ...compareArms(pick("control", f), pick("treatment", f), { seed: 1 }),
  });
  return {
    completed: rows.length,
    perArm: {
      control: rows.filter((r) => r.arm === "control").length,
      treatment: rows.filter((r) => r.arm === "treatment").length,
    },
    primary: outcome("factor_hhi", (r) => r.factor_hhi),
    secondary: [
      outcome("effective_sectors", (r) => r.effective_sectors),
      outcome("top_factor_share", (r) => r.top_factor_share),
      outcome("post_perceived_diversification", (r) => r.post_perceived_diversification),
      outcome("post_confidence", (r) => r.post_confidence),
    ],
    plannedPerArm: {
      smallEffect: requiredPerArm(0.2),
      mediumEffect: requiredPerArm(0.5),
      largeEffect: requiredPerArm(0.8),
    },
  };
}
