import { z } from "zod";
import { fetchJson, type FetchJsonOptions } from "../http";
import { ProviderError, type DailyBar, type PriceProvider } from "./types";

const rowSchema = z.object({
  date: z.string(),
  open: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  close: z.number(),
  adjClose: z.number(),
  volume: z.number().nullable().optional(),
});

/**
 * Tiingo end-of-day prices. Field names follow Tiingo's documented daily prices response;
 * verify against live data when the provider spike runs (ADR 0003).
 */
export class TiingoProvider implements PriceProvider {
  readonly name = "tiingo";

  constructor(
    private readonly apiKey: string,
    private readonly http: Omit<FetchJsonOptions, "provider"> = {},
  ) {
    if (!apiKey) throw new Error("Tiingo API key is required");
  }

  async getDailyBars(ticker: string, from: string, to: string): Promise<DailyBar[]> {
    const url =
      `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices` +
      `?startDate=${from}&endDate=${to}&token=${this.apiKey}`;
    const raw = await fetchJson(url, { ...this.http, provider: this.name });
    const parsed = z.array(rowSchema).safeParse(raw);
    if (!parsed.success)
      throw new ProviderError(this.name, "unexpected response shape", "bad_response");
    return parsed.data
      .map((r) => ({
        date: r.date.slice(0, 10),
        open: r.open ?? null,
        high: r.high ?? null,
        low: r.low ?? null,
        close: r.close,
        adjClose: r.adjClose,
        volume: r.volume ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
