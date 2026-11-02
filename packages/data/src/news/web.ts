import { createHash } from "node:crypto";
import { canonicalUrl } from "./normalize";
import type { NewsProvider, RawArticle } from "./types";

/** One web search result: the page's own text plus when it says it was published. */
export interface WebNewsResult {
  title: string;
  url: string;
  snippet: string;
  /** As the search tool states it, for example "2 days ago" or "3 months ago". */
  published?: string;
  /** An exact timestamp when the tool gives one (ISO). */
  publishedAt?: string;
}

export interface WebNewsSearcher {
  search(query: string): Promise<WebNewsResult[]>;
}

const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

/**
 * A publication time from the search tool's wording. Relative forms ("3 hours ago", "yesterday", "an hour ago") are
 * counted back from `now`; an absolute date is parsed. Null when there is no usable date: such a page cannot be
 * placed in time, so it is not stored as news.
 */
export function parsePublished(text: string | undefined, now: Date): Date | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (t === "today" || t === "just now") return now;
  if (t === "yesterday") return new Date(now.getTime() - UNIT_MS.day!);
  const rel = /^(\d+|an?|one)\s+(minute|hour|day|week|month|year)s?\s+ago$/.exec(t);
  if (rel) {
    const n = /^\d+$/.test(rel[1]!) ? Number(rel[1]) : 1;
    return new Date(now.getTime() - n * UNIT_MS[rel[2]!]!);
  }
  const abs = Date.parse(
    text
      .replace(/\s+UTC$/i, "Z")
      .replace(/^(\w{3}) (\w{3}) (\d+) ([\d:]+) (\d{4})Z$/, "$2 $3 $5 $4 UTC"),
  );
  return Number.isFinite(abs) ? new Date(abs) : null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * News found by searching the web for each company. Results only mention the company, so they are not tagged with
 * the queried ticker: they are linked to companies by name matching afterwards, like any other article. Pages
 * without a publication date, or outside the requested range, are dropped.
 */
export class WebNewsProvider implements NewsProvider {
  readonly name = "web";
  readonly tagsQueriedTicker = false;

  constructor(
    private readonly searcher: WebNewsSearcher,
    /** Company name by ticker, to write a better query. */
    private readonly names: ReadonlyMap<string, string>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getCompanyNews(ticker: string, from: string, to: string): Promise<RawArticle[]> {
    const name = this.names.get(ticker) ?? ticker;
    const results = await this.searcher.search(
      `${name} (${ticker}) stock news between ${from} and ${to}: earnings, guidance, deals, regulation, analyst moves`,
    );
    const lo = Date.parse(`${from}T00:00:00Z`);
    const hi = Date.parse(`${to}T23:59:59Z`);
    const out: RawArticle[] = [];
    for (const r of results) {
      const at = r.publishedAt ? new Date(r.publishedAt) : parsePublished(r.published, this.now());
      if (!at || Number.isNaN(at.getTime()) || at.getTime() < lo || at.getTime() > hi) continue;
      const url = canonicalUrl(r.url);
      out.push({
        providerId: createHash("sha256").update(url).digest("hex").slice(0, 32),
        url,
        title: r.title,
        snippet: r.snippet,
        sourceName: hostOf(url),
        publishedAt: at,
        tickers: [],
      });
    }
    return out;
  }
}
