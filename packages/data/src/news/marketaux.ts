import { z } from "zod";
import { fetchJson, type FetchJsonOptions } from "../http";
import { ProviderError } from "../providers/types";
import type { NewsProvider, RawArticle } from "./types";

const rowSchema = z.object({
  uuid: z.string(),
  title: z.string(),
  description: z.string().optional().nullable(),
  snippet: z.string().optional().nullable(),
  url: z.string(),
  published_at: z.string(),
  source: z.string().optional().nullable(),
  entities: z
    .array(z.object({ symbol: z.string().optional().nullable() }))
    .optional()
    .nullable(),
});

const envelope = z.object({ data: z.array(z.unknown()) });

/** Marketaux news. Field names follow Marketaux's documented response; verify against live data. */
export class MarketauxNewsProvider implements NewsProvider {
  readonly name = "marketaux";

  constructor(
    private readonly apiKey: string,
    private readonly http: Omit<FetchJsonOptions, "provider"> = {},
  ) {
    if (!apiKey) throw new Error("Marketaux API key is required");
  }

  async getCompanyNews(ticker: string, from: string, to: string): Promise<RawArticle[]> {
    const url =
      `https://api.marketaux.com/v1/news/all?symbols=${encodeURIComponent(ticker)}&filter_entities=true&language=en` +
      `&published_after=${from}T00:00:00&published_before=${to}T23:59:59&api_token=${this.apiKey}`;
    const raw = await fetchJson(url, { ...this.http, provider: this.name });
    const env = envelope.safeParse(raw);
    if (!env.success)
      throw new ProviderError(this.name, "unexpected response shape", "bad_response");
    // Skip individual malformed rows rather than failing the whole page.
    return env.data.data.flatMap((item) => {
      const r = rowSchema.safeParse(item);
      if (!r.success || !r.data.title.trim()) return [];
      const publishedAt = new Date(r.data.published_at);
      if (Number.isNaN(publishedAt.getTime())) return [];
      return [
        {
          providerId: r.data.uuid,
          url: r.data.url,
          title: r.data.title.trim(),
          snippet: (r.data.description || r.data.snippet || "").trim() || null,
          sourceName: r.data.source ?? null,
          publishedAt,
          tickers: (r.data.entities ?? []).flatMap((e) =>
            e.symbol ? [e.symbol.toUpperCase()] : [],
          ),
        },
      ];
    });
  }
}
