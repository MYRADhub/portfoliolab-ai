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
  /** Articles about `ticker` published in [from, to] (YYYY-MM-DD, inclusive). Throws ProviderError on failure. */
  getCompanyNews(ticker: string, from: string, to: string): Promise<RawArticle[]>;
}
