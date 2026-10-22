import { z } from "zod";
import { fetchJson, type FetchJsonOptions } from "../http";
import { ProviderError, type DailyBar, type PriceProvider } from "./types";

const numArray = z.array(z.number().nullable());

const responseSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({ gmtoffset: z.number() }),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z.array(
              z.object({
                open: numArray,
                high: numArray,
                low: numArray,
                close: numArray,
                volume: numArray,
              }),
            ),
            adjclose: z.array(z.object({ adjclose: numArray })).optional(),
          }),
        }),
      )
      .nullable(),
    error: z.unknown().nullable().optional(),
  }),
});

const epoch = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);

/**
 * Daily prices from Yahoo Finance's public chart endpoint. It needs no key but is unofficial: it has no published
 * limits or terms for programmatic use, so keep request rates low and treat the data as research-grade. Bars dated
 * today (UTC) or later are dropped because they may still be forming.
 */
export class YahooProvider implements PriceProvider {
  readonly name = "yahoo";

  constructor(
    private readonly http: Omit<FetchJsonOptions, "provider"> = {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getDailyBars(ticker: string, from: string, to: string): Promise<DailyBar[]> {
    // Yahoo writes share classes with a hyphen (BRK-B); our canonical form is BRK.B.
    const symbol = ticker.replace(".", "-");
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=${epoch(from)}&period2=${epoch(to) + 86_400}&interval=1d&events=div%2Csplit`;
    const raw = await fetchJson(url, {
      ...this.http,
      provider: this.name,
      headers: { "user-agent": "Mozilla/5.0 (PortfolioLab research)" },
    });
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success)
      throw new ProviderError(this.name, "unexpected response shape", "bad_response");
    const result = parsed.data.chart.result?.[0];
    if (!result) throw new ProviderError(this.name, "no data", "not_found");

    const ts = result.timestamp ?? [];
    const q = result.indicators.quote[0];
    const adj = result.indicators.adjclose?.[0]?.adjclose;
    if (!q) throw new ProviderError(this.name, "no quote data", "bad_response");
    const today = this.now().toISOString().slice(0, 10);

    const bars: DailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const close = q.close[i];
      if (close === null || close === undefined) continue; // holiday placeholder
      // The timestamp is the session open in the exchange's local time; shift to get the trading date.
      const date = new Date((ts[i]! + result.meta.gmtoffset) * 1000).toISOString().slice(0, 10);
      if (date < from || date > to || date >= today) continue;
      bars.push({
        date,
        open: q.open[i] ?? null,
        high: q.high[i] ?? null,
        low: q.low[i] ?? null,
        close,
        adjClose: adj?.[i] ?? close,
        volume: q.volume[i] ?? null,
      });
    }
    return bars.sort((a, b) => a.date.localeCompare(b.date));
  }
}
