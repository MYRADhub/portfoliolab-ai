import { describe, expect, it } from "vitest";
import { buildInsights, currentDrawdown, THRESHOLDS } from "./insights";
import type { Terminal } from "./terminal";

function terminal(over: Partial<Terminal> = {}): Terminal {
  const equity = [100, 110, 120, 118].map((value, i) => ({ date: `d${i}`, value }));
  return {
    portfolio: { id: "p", name: "P" },
    asOf: "d3",
    window: { from: "d0", to: "d3", tradingDays: 4 },
    index: { value: 118, dayChange: -0.017 },
    equity,
    performance: [],
    // Ordered by weight, as the real service returns them.
    holdings: [
      {
        ticker: "JPM",
        name: "J",
        sector: "Fin",
        weight: 0.75,
        price: 1,
        d1: 0,
        d5: 0,
        m1: 0,
        riskShare: 0.65,
        sparkline: [100, 100],
      },
      {
        ticker: "NVDA",
        name: "N",
        sector: "IT",
        weight: 0.25,
        price: 1,
        d1: 0,
        d5: 0,
        m1: 0,
        riskShare: 0.35,
        sparkline: [100, 100],
      },
    ],
    risk: {
      volatility: 0.1,
      sharpe: 1,
      maxDrawdown: -0.12,
      var95: -0.01,
      var99: -0.02,
      expectedShortfall95: -0.02,
      best: { date: "a", value: 0.02 },
      worst: { date: "b", value: -0.03 },
      upDayShare: 0.5,
    },
    extremes: { best: [], worst: [] },
    rollingVolatility: [],
    histogram: [],
    monthly: [],
    drawdowns: [],
    correlation: { average: 0.7, topPairs: [] },
    news: [
      {
        title: "Chip rules tighten",
        url: "u",
        score: 7.2,
        tickers: ["NVDA"],
        class: "fundamental",
      },
    ],
    exposures: {
      available: true,
      effectiveFactors: 3,
      effectiveSectors: 5,
      topFactors: [{ name: "AI spending", net: 1, share: 0.4 }],
    },
    ...over,
  };
}
const move = {
  date: "d3",
  portfolioReturn: -0.017,
  headline: "About 60% of the day's decline came from IT holdings.",
};
const byId = (t: Terminal, m = move) =>
  Object.fromEntries(buildInsights(t, m).map((i) => [i.id, i]));

describe("currentDrawdown", () => {
  it("is the distance below the highest value so far", () => {
    expect(currentDrawdown([{ value: 100 }, { value: 120 }, { value: 108 }])).toBeCloseTo(-0.1, 12);
    expect(currentDrawdown([{ value: 100 }, { value: 120 }])).toBe(0);
  });
});

describe("buildInsights", () => {
  it("flags hidden concentration when forces are fewer than sectors, and says why in numbers", () => {
    const i = byId(terminal());
    expect(i["hidden-concentration"]).toMatchObject({ severity: "watch", href: "/exposures" });
    expect(i["hidden-concentration"]!.detail).toContain("5.0 separate groups");
    expect(i["hidden-concentration"]!.detail).toContain("only 3.0");
  });

  it("is reassuring when forces are at least as spread as sectors", () => {
    const i = byId(
      terminal({
        exposures: {
          available: true,
          effectiveFactors: 8,
          effectiveSectors: 5,
          topFactors: [{ name: "Rates", net: 1, share: 0.1 }],
        },
      }),
    );
    expect(i["hidden-concentration"]!.severity).toBe("info");
    expect(i["top-force"]).toBeUndefined();
  });

  it("falls back to weights when exposure data is missing", () => {
    const i = byId(terminal({ exposures: { available: false, reason: "no_factors" } }));
    expect(i["hidden-concentration"]).toMatchObject({ severity: "watch" }); // JPM is 75%
    expect(i["hidden-concentration"]!.title).toContain("JPM");
    expect(i["top-force"]).toBeUndefined();
  });

  it("calls out the holding whose risk share most exceeds its weight, naming both numbers", () => {
    // NVDA: 25% of the money, 35% of the risk, 1.4 times its weight.
    const r = byId(terminal())["risk-driver"]!;
    expect(r).toMatchObject({
      severity: "watch",
      title: "NVDA drives more risk than its size",
      href: "/terminal#risk",
    });
    expect(r.detail).toBe("NVDA is 25% of your money but 35% of your portfolio's ups and downs.");
  });

  it("uses the 1.25 overweight threshold exactly: at the line is fine, above it is flagged", () => {
    const mk = (a: number) =>
      terminal({
        holdings: [
          {
            ticker: "B",
            name: "B",
            sector: "S",
            weight: 0.6,
            price: 1,
            d1: 0,
            d5: 0,
            m1: 0,
            riskShare: 1 - a,
            sparkline: [1, 1],
          },
          {
            ticker: "A",
            name: "A",
            sector: "S",
            weight: 0.4,
            price: 1,
            d1: 0,
            d5: 0,
            m1: 0,
            riskShare: a,
            sparkline: [1, 1],
          },
        ],
      });
    expect(THRESHOLDS.riskOverweight).toBe(1.25);
    expect(byId(mk(0.5))["risk-driver"]!.severity).toBe("info"); // 0.5 is exactly 1.25 times 0.4
    expect(byId(mk(0.51))["risk-driver"]!.severity).toBe("watch");
    expect(byId(mk(0.3))["risk-driver"]!.severity).toBe("info"); // risk below weight
  });

  it("scales drawdown severity and recognises a new high", () => {
    const eq = (v: number[]) => v.map((value, i) => ({ date: `d${i}`, value }));
    expect(byId(terminal({ equity: eq([100, 120, 107]) }))["drawdown"]!.severity).toBe("alert"); // -10.8%
    expect(byId(terminal({ equity: eq([100, 120, 112]) }))["drawdown"]!.severity).toBe("watch"); // -6.7%
    expect(byId(terminal({ equity: eq([100, 120, 119]) }))["drawdown"]!.severity).toBe("info");
    expect(byId(terminal({ equity: eq([100, 120, 130]) }))["drawdown"]!.title).toBe(
      "At a new high",
    );
  });

  it("includes the latest move with a severity that follows its size", () => {
    expect(byId(terminal(), { ...move, portfolioReturn: -0.017 })["latest-move"]).toMatchObject({
      severity: "watch",
      title: "Latest day: -1.70%",
    });
    expect(byId(terminal(), { ...move, portfolioReturn: 0.004 })["latest-move"]!.severity).toBe(
      "info",
    );
    expect(byId(terminal())["latest-move"]!.detail).toBe(move.headline);
  });

  it("handles correlation and news presence, level and absence", () => {
    expect(byId(terminal())["correlation"]!.severity).toBe("watch");
    expect(
      byId(terminal({ correlation: { average: 0.2, topPairs: [] } }))["correlation"]!.severity,
    ).toBe("info");
    expect(byId(terminal({ correlation: null }))["correlation"]).toBeUndefined();
    expect(byId(terminal())["top-news"]).toMatchObject({
      severity: "watch",
      title: "A high-relevance story for you",
    });
    expect(
      byId(
        terminal({
          news: [{ title: "Minor", url: "u", score: 1.2, tickers: ["JPM"], class: null }],
        }),
      )["top-news"]!.severity,
    ).toBe("info");
    expect(byId(terminal({ news: [] }))["top-news"]).toBeUndefined();
  });

  it("orders alerts before watches before infos and gives every card a link", () => {
    const list = buildInsights(
      terminal({ equity: [100, 120, 100].map((value, i) => ({ date: `d${i}`, value })) }),
      move,
    );
    const rank = { alert: 0, watch: 1, info: 2 } as const;
    expect(list.map((i) => rank[i.severity])).toEqual(
      [...list.map((i) => rank[i.severity])].sort(),
    );
    expect(list[0]!.severity).toBe("alert");
    for (const i of list) {
      expect(i.href.startsWith("/")).toBe(true);
      expect(i.title.length).toBeGreaterThan(5);
      expect(i.linkLabel.length).toBeGreaterThan(3);
    }
  });
});
