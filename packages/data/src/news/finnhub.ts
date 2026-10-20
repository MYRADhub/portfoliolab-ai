import { z } from "zod";
import { fetchJson, type FetchJsonOptions } from "../http";
import { ProviderError } from "../providers/types";
import type { NewsProvider, RawArticle } from "./types";

const rowSchema = z.object({
  id: z.union([z.number(), z.string()]),
  datetime: z.number(),
  headline: z.string(),
  summary: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  url: z.string(),
  related: z.string().optional().nullable(),
});

/** Finnhub company news. Field names follow Finnhub's documented response; verify against live data. */
export class FinnhubNewsProvider implements NewsProvider {
  readonly name = "finnhub";

  constructor(
    private readonly apiKey: string,
    private readonly http: Omit<FetchJsonOptions, "provider"> = {},
  ) {
    if (!apiKey) throw new Error("Finnhub API key is required");
  }

  async getCompanyNews(ticker: string, from: string, to: string): Promise<RawArticle[]> {
    const url =
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}` +
      `&from=${from}&to=${to}&token=${this.apiKey}`;
    const raw = await fetchJson(url, { ...this.http, provider: this.name });
    const parsed = z.array(rowSchema).safeParse(raw);
    if (!parsed.success)
      throw new ProviderError(this.name, "unexpected response shape", "bad_response");
    return parsed.data.flatMap((r) => {
      if (!r.headline.trim() || !r.url) return [];
      return [
        {
          providerId: String(r.id),
          url: r.url,
          title: r.headline.trim(),
          snippet: r.summary?.trim() || null,
          sourceName: r.source ?? null,
          publishedAt: new Date(r.datetime * 1000),
          tickers: (r.related ?? "")
            .split(",")
            .map((t) => t.trim().toUpperCase())
            .filter(Boolean),
        },
      ];
    });
  }
}
