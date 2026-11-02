export interface RawArticle {
  providerId: string;
  url: string;
  title: string;
  snippet?: string | null;
  body?: string | null;
  sourceName?: string | null;
  publishedAt: Date;
  /** Tickers the provider itself tagged this article with. */
  tickers: string[];
}

export interface NewsProvider {
  readonly name: string;
  /**
   * False when results are not reliably about the queried company (a web search returns pages that only mention
   * it): the article is then linked only through name matching, not tagged with the queried ticker.
   */
  readonly tagsQueriedTicker?: boolean;
  /** Articles about `ticker` published in [from, to] (YYYY-MM-DD, inclusive). Throws ProviderError on failure. */
  getCompanyNews(ticker: string, from: string, to: string): Promise<RawArticle[]>;
}
