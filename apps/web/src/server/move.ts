import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  eventTypes,
  newsArticles,
  newsClassifications,
  newsCompanyLinks,
  type Db,
} from "@portfolio-lab/db";
import { eventTradingDate, loadTradingDays, MIN_LINK_SCORE } from "@portfolio-lab/data";
import { dailyReturns, dayContributions, groupContributions } from "@portfolio-lab/finance";
import { factsFromEntries, type Fact } from "@portfolio-lab/explain";
import { pct } from "@/lib/format";
import { AppError } from "./errors";
import { addDays, loadPortfolioWithPrices, monthsAgo } from "./portfolio-data";

/** How many recent trading days can be picked, and how many linked news items are shown. */
export const MOVE_DATE_CHOICES = 30;
export const MOVE_NEWS_LIMIT = 10;

export interface MoveHolding {
  ticker: string;
  name: string;
  sector: string;
  weight: number;
  /** The stock's own return that day, as a fraction. */
  assetReturn: number;
  /** Contribution to the portfolio return, as a fraction (0.01 is one percentage point). */
  contribution: number;
}

export interface MoveNews {
  title: string;
  url: string;
  source: string | null;
  publishedAt: string;
  session: string | null;
  tickers: string[];
  linkScore: number;
  /** Other articles merged into this one as near-duplicates. */
  copies: number;
  classification: {
    class: string;
    eventType: string | null;
    fundamentalImportance: number;
    marketRelevance: number;
    expectedPersistence: number;
    mechanism: string;
  } | null;
}

export interface PortfolioMove {
  portfolio: { id: string; name: string };
  date: string;
  previousDate: string;
  availableDates: string[];
  portfolioReturn: number;
  headline: string;
  holdings: MoveHolding[];
  groups: { group: string; contribution: number; share: number | null }[];
  news: MoveNews[];
}

/** Percentage points with a sign, for example "+0.42". Two decimals because daily moves are small. */
export const pp = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}`;
export const signedPct2 = (x: number) => `${pp(x)}%`;

export function buildHeadline(total: number, groups: PortfolioMove["groups"]): string {
  if (groups.length === 0 || Math.abs(total) < 0.0005)
    return "The portfolio moved by less than 0.05% that day.";
  const word = total < 0 ? "decline" : "gain";
  const top = groups[0]!;
  if (top.share !== null && top.share >= 0.5 && top.share <= 1) {
    return `About ${Math.round(top.share * 100)}% of the day's ${word} came from ${top.group} holdings.`;
  }
  if (top.share !== null && top.share > 1) {
    // Other sectors moved the opposite way, so this group explains more than the whole net move.
    return `${top.group} holdings were the biggest ${total < 0 ? "drag" : "lift"} at ${pp(top.contribution)} percentage points, partly offset by moves in other sectors.`;
  }
  return `The ${word} was spread across sectors; the largest effect came from ${top.group} holdings at ${pp(top.contribution)} percentage points.`;
}

async function linkedNews(
  db: Db,
  companyIds: number[],
  tickerById: Map<number, string>,
  date: string,
): Promise<MoveNews[]> {
  if (companyIds.length === 0) return [];
  // News published up to four days earlier can roll forward to this trading day (weekends, holidays, after hours).
  const from = addDays(date, -4);
  const isTrading = await loadTradingDays(db, addDays(date, -10), addDays(date, 1));
  const rows = await db
    .select({
      id: newsArticles.id,
      title: newsArticles.title,
      url: newsArticles.url,
      source: newsArticles.sourceName,
      publishedAt: newsArticles.publishedAt,
      session: newsArticles.marketSession,
      clusterId: newsArticles.clusterId,
      companyId: newsCompanyLinks.companyId,
      score: newsCompanyLinks.score,
    })
    .from(newsCompanyLinks)
    .innerJoin(newsArticles, eq(newsArticles.id, newsCompanyLinks.articleId))
    .where(
      and(
        inArray(newsCompanyLinks.companyId, companyIds),
        gte(newsCompanyLinks.score, MIN_LINK_SCORE),
        gte(newsArticles.publishedAt, new Date(`${from}T00:00:00Z`)),
        lte(newsArticles.publishedAt, new Date(`${addDays(date, 1)}T23:59:59Z`)),
      ),
    );

  const onDate = rows.filter((r) => eventTradingDate(r.publishedAt, isTrading) === date);

  // One entry per near-duplicate group: the earliest article, with the best link score per company.
  const groups = new Map<number, typeof onDate>();
  for (const r of onDate) {
    const key = r.clusterId ?? r.id;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const picked = [...groups.values()].map((members) => {
    const earliest = members.reduce((a, b) => (b.publishedAt < a.publishedAt ? b : a));
    const articleIds = new Set(members.map((m) => m.id));
    const perCompany = new Map<number, number>();
    for (const m of members.filter((m) => m.id === earliest.id))
      perCompany.set(m.companyId, Math.max(perCompany.get(m.companyId) ?? 0, m.score));
    return { earliest, copies: articleIds.size - 1, perCompany };
  });

  const ids = picked.map((p) => p.earliest.id);
  const cls = ids.length
    ? await db
        .select({
          articleId: newsClassifications.articleId,
          class: newsClassifications.class,
          eventType: eventTypes.slug,
          fundamentalImportance: newsClassifications.fundamentalImportance,
          marketRelevance: newsClassifications.marketRelevance,
          expectedPersistence: newsClassifications.expectedPersistence,
          mechanism: newsClassifications.mechanism,
        })
        .from(newsClassifications)
        .leftJoin(eventTypes, eq(eventTypes.id, newsClassifications.eventTypeId))
        .where(inArray(newsClassifications.articleId, ids))
        .orderBy(desc(newsClassifications.createdAt))
    : [];
  const latest = new Map<number, (typeof cls)[number]>();
  for (const c of cls) if (!latest.has(c.articleId)) latest.set(c.articleId, c);

  const items: MoveNews[] = picked.map(({ earliest, copies, perCompany }) => {
    const c = latest.get(earliest.id);
    return {
      title: earliest.title,
      url: earliest.url,
      source: earliest.source,
      publishedAt: earliest.publishedAt.toISOString(),
      session: earliest.session,
      tickers: [...perCompany.keys()].map((id) => tickerById.get(id)!).sort(),
      linkScore: Math.max(...perCompany.values()),
      copies,
      classification: c
        ? {
            class: c.class,
            eventType: c.eventType,
            fundamentalImportance: c.fundamentalImportance,
            marketRelevance: c.marketRelevance,
            expectedPersistence: c.expectedPersistence,
            mechanism: c.mechanism,
          }
        : null,
    };
  });
  // Most economically important first, then strongest company link, then newest.
  return items
    .sort(
      (a, b) =>
        (b.classification?.fundamentalImportance ?? -1) -
          (a.classification?.fundamentalImportance ?? -1) ||
        b.linkScore - a.linkScore ||
        b.publishedAt.localeCompare(a.publishedAt),
    )
    .slice(0, MOVE_NEWS_LIMIT);
}

/** Splits a day's portfolio return into per-holding and per-sector contributions and lists the linked news. */
export async function getPortfolioMove(
  db: Db,
  sessionId: string,
  portfolioId: string,
  opts: { date?: string; now?: Date } = {},
): Promise<PortfolioMove> {
  const { now = new Date() } = opts;
  const loaded = await loadPortfolioWithPrices(db, sessionId, portfolioId, monthsAgo(now, 12));
  const { holdings: hs, series, dates } = loaded;
  const returns = series.map((s) => dailyReturns(s, dates));

  const selectable = dates.slice(1); // the first shared day has no previous day, so no return
  const date = opts.date ?? selectable.at(-1)!;
  const t = selectable.indexOf(date);
  if (t === -1) {
    throw new AppError(
      "bad_request",
      `${date} is not a trading day with shared price history for this portfolio`,
      {
        earliest: selectable[0],
        latest: selectable.at(-1),
      },
    );
  }

  const contributions = dayContributions(
    hs.map((h) => h.weight),
    returns,
    t,
  );
  const holdings: MoveHolding[] = contributions
    .map((c) => {
      const h = hs[c.index]!;
      return {
        ticker: h.ticker,
        name: h.name,
        sector: h.sector ?? "Unclassified",
        weight: h.weight,
        assetReturn: c.assetReturn,
        contribution: c.contribution,
      };
    })
    .sort(
      (a, b) =>
        Math.abs(b.contribution) - Math.abs(a.contribution) || a.ticker.localeCompare(b.ticker),
    );

  const { total, groups } = groupContributions(
    holdings.map((h) => ({ group: h.sector, contribution: h.contribution })),
  );
  const news = await linkedNews(
    db,
    hs.map((h) => h.companyId),
    new Map(hs.map((h) => [h.companyId, h.ticker])),
    date,
  );

  return {
    portfolio: loaded.portfolio,
    date,
    previousDate: dates[t]!,
    availableDates: selectable.slice(-MOVE_DATE_CHOICES).reverse(),
    portfolioReturn: total,
    headline: buildHeadline(total, groups),
    holdings,
    groups,
    news,
  };
}

/** The task given to the model for a move. It is told news may coincide with, not cause, a move. */
export function moveTask(move: PortfolioMove): string {
  return `Explain why the portfolio moved on ${move.date}: which holdings and sectors drove the move. If linked news is listed, mention it only as coinciding with the move; never claim it caused the move.`;
}

export function buildMoveFacts(move: PortfolioMove): Fact[] {
  const entries: { label: string; text: string }[] = [
    { label: "Day analysed", text: `${move.date} (previous trading day ${move.previousDate})` },
    { label: "Portfolio return that day", text: signedPct2(move.portfolioReturn) },
    {
      label: "Method",
      text: "Contribution is weight times the stock's return, in percentage points; weights are constant targets",
    },
    { label: "Headline", text: move.headline },
  ];
  for (const h of move.holdings.slice(0, 3)) {
    entries.push({
      label: "Holding contribution",
      text: `${h.ticker} ${pp(h.contribution)} percentage points (weight ${pct(h.weight)}, return ${signedPct2(h.assetReturn)})`,
    });
  }
  for (const g of move.groups.slice(0, 3)) {
    entries.push({
      label: "Sector contribution",
      text: `${g.group} ${pp(g.contribution)} percentage points${g.share === null ? "" : ` (${Math.round(g.share * 100)}% of the move)`}`,
    });
  }
  for (const n of move.news.slice(0, 3)) {
    entries.push({
      label: "Linked news",
      text: `${n.title} (${n.classification?.class ?? "not yet classified"}, ${n.tickers.join(" and ")})`,
    });
  }
  if (move.news.length === 0)
    entries.push({ label: "Linked news", text: "none found for this day" });
  entries.push({
    label: "Caution",
    text: "News is linked by company mentions and may coincide with, not cause, a price move",
  });
  return factsFromEntries(entries);
}
