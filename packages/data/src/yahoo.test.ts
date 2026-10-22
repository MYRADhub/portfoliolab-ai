import { describe, expect, it } from "vitest";
import { ProviderError, YahooProvider } from "./index";

const body = (over: Record<string, unknown> = {}) => ({
  chart: {
    error: null,
    result: [
      {
        meta: { gmtoffset: -14400 },
        // 2026-10-14, 15 and 16 at 13:30 UTC (09:30 Eastern, the session open)
        timestamp: [1791984600, 1792071000, 1792157400],
        indicators: {
          quote: [
            {
              open: [10, 11, 12],
              high: [11, 12, 13],
              low: [9, 10, 11],
              close: [10.5, null, 12.5],
              volume: [100, null, 300],
            },
          ],
          adjclose: [{ adjclose: [10.4, null, 12.4] }],
        },
        ...over,
      },
    ],
  },
});

const ok = (b: unknown) =>
  (async () => new Response(JSON.stringify(b), { status: 200 })) as typeof fetch;
const noon = () => new Date("2026-10-20T12:00:00Z");

describe("YahooProvider", () => {
  it("maps bars, uses the exchange-local trading date, skips holiday placeholders and sorts ascending", async () => {
    const bars = await new YahooProvider({ fetchImpl: ok(body()) }, noon).getDailyBars(
      "X",
      "2026-10-01",
      "2026-10-19",
    );
    expect(bars).toEqual([
      { date: "2026-10-14", open: 10, high: 11, low: 9, close: 10.5, adjClose: 10.4, volume: 100 },
      { date: "2026-10-16", open: 12, high: 13, low: 11, close: 12.5, adjClose: 12.4, volume: 300 },
    ]);
  });

  it("drops bars dated today or later, and bars outside the requested range", async () => {
    const p = new YahooProvider({ fetchImpl: ok(body()) }, () => new Date("2026-10-16T20:00:00Z"));
    const bars = await p.getDailyBars("X", "2026-10-15", "2026-10-20");
    expect(bars).toEqual([]); // 14th is before `from`, 16th is today
  });

  it("falls back to the close when no adjusted close is provided", async () => {
    const b = body();
    delete (b.chart.result![0]!.indicators as { adjclose?: unknown }).adjclose;
    const bars = await new YahooProvider({ fetchImpl: ok(b) }, noon).getDailyBars(
      "X",
      "2026-10-01",
      "2026-10-19",
    );
    expect(bars[0]!.adjClose).toBe(10.5);
  });

  it("asks for hyphenated share classes and sends a user agent", async () => {
    let url = "";
    let ua: string | undefined;
    const fetchImpl = (async (u: string, init?: RequestInit) => {
      url = u;
      ua = (init?.headers as Record<string, string>)["user-agent"];
      return new Response(JSON.stringify(body()), { status: 200 });
    }) as unknown as typeof fetch;
    await new YahooProvider({ fetchImpl }, noon).getDailyBars("BRK.B", "2026-10-01", "2026-10-19");
    expect(url).toContain("/chart/BRK-B?");
    expect(ua).toMatch(/PortfolioLab/);
  });

  it("reports not found for an empty result or a 404, and a bad shape for garbage", async () => {
    const empty = new YahooProvider(
      { fetchImpl: ok({ chart: { result: null, error: { code: "Not Found" } } }) },
      noon,
    );
    await expect(empty.getDailyBars("X", "2026-10-01", "2026-10-19")).rejects.toMatchObject({
      kind: "not_found",
    });
    const missing = new YahooProvider(
      { fetchImpl: (async () => new Response("{}", { status: 404 })) as typeof fetch },
      noon,
    );
    await expect(missing.getDailyBars("X", "2026-10-01", "2026-10-19")).rejects.toBeInstanceOf(
      ProviderError,
    );
    const junk = new YahooProvider({ fetchImpl: ok({ nope: 1 }) }, noon);
    await expect(junk.getDailyBars("X", "2026-10-01", "2026-10-19")).rejects.toMatchObject({
      kind: "bad_response",
    });
  });
});
