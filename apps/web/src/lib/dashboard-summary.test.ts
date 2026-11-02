import { describe, expect, it } from "vitest";
import {
  calmness,
  contributions,
  summarize,
  trailingReturn,
  yearToDate,
} from "./dashboard-summary";

const holdings = [
  { ticker: "NVDA", weight: 0.1, m1: 0.11, riskShare: 0.18 },
  { ticker: "KO", weight: 0.3, m1: -0.01, riskShare: 0.2 },
  { ticker: "JPM", weight: 0.6, m1: 0.01, riskShare: 0.62 },
];

describe("dashboard summary", () => {
  it("says how the month went, against the market, what drove it, and the main risks", () => {
    const bench = Array.from({ length: 30 }, (_, i) => (i < 9 ? 100 : 101));
    const s = summarize({
      monthReturn: 0.018,
      holdings,
      topForce: { name: "AI capital spending", share: 0.34 },
      curves: { dates: [], portfolio: [], benchmark: bench },
    });
    expect(s.headline).toBe("Up 1.8% this month");
    expect(s.tone).toBe("gain");
    expect(s.lines).toEqual([
      "0.8 points ahead of the S&P 500, which moved +1.0%.",
      "NVDA added the most (+1.10 points); KO held it back (−0.30 points).",
      "NVDA is 10% of your money but 18% of the ups and downs.",
      "Your largest hidden exposure is AI capital spending, 34% of all exposure.",
    ]);
  });

  it("handles falls, flat months and missing data", () => {
    expect(summarize({ monthReturn: -0.052, holdings: [], topForce: null, curves: null })).toEqual({
      headline: "Down 5.2% this month",
      tone: "loss",
      lines: [],
    });
    expect(
      summarize({ monthReturn: 0.0001, holdings: [], topForce: null, curves: null }).headline,
    ).toBe("Flat this month");
    expect(summarize({ monthReturn: null, holdings: [], topForce: null, curves: null }).tone).toBe(
      "flat",
    );
  });

  it("ranks contributions by size and skips holdings without a month of prices", () => {
    expect(
      contributions([...holdings, { ticker: "NEW", weight: 0.1, m1: null, riskShare: 0 }]).map(
        (c) => c.ticker,
      ),
    ).toEqual(["NVDA", "JPM", "KO"]);
  });

  it("computes trailing and year-to-date returns and names volatility levels", () => {
    expect(trailingReturn([100, 110, 121], 2)).toBeCloseTo(0.21, 10);
    expect(trailingReturn([100], 1)).toBeNull();
    expect(
      yearToDate(["2025-12-30", "2025-12-31", "2026-01-02", "2026-03-01"], [90, 100, 101, 120]),
    ).toBeCloseTo(0.2, 10);
    expect(yearToDate(["2026-01-02"], [100])).toBeNull();
    expect([0.08, 0.15, 0.25, 0.4].map(calmness)).toEqual([
      "Calm",
      "Moderate",
      "Lively",
      "Very bumpy",
    ]);
  });
});
