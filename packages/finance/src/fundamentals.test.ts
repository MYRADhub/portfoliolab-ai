import { describe, expect, it } from "vitest";
import { fundamentalRatios, type FiscalYear } from "./index";

const close = (a: number | null, b: number, tol = 1e-12) =>
  expect(Math.abs(a! - b)).toBeLessThan(tol);
const year = (fiscalYear: number, over: Partial<FiscalYear> = {}): FiscalYear => ({
  fiscalYear,
  revenue: 1000,
  netIncome: 100,
  operatingIncome: 150,
  epsDiluted: 2,
  operatingCashFlow: 200,
  totalAssets: 5000,
  equity: 500,
  ...over,
});

describe("fundamentalRatios", () => {
  it("matches a hand calculation from the latest year, whatever the input order", () => {
    const r = fundamentalRatios([year(2023, { revenue: 800 }), year(2024, { revenue: 1000 })], 30)!;
    expect(r.fiscalYear).toBe(2024);
    close(r.revenueGrowth, 0.25);
    close(r.netMargin, 0.1);
    close(r.operatingMargin, 0.15);
    close(r.returnOnEquity, 0.2);
    close(r.priceToEarnings, 15);
  });

  it("leaves a ratio empty when its inputs are missing or meaningless", () => {
    const r = fundamentalRatios([year(2024, { revenue: null, equity: -5, epsDiluted: -1 })], 30)!;
    expect(r).toMatchObject({
      revenueGrowth: null,
      netMargin: null,
      operatingMargin: null,
      returnOnEquity: null,
      priceToEarnings: null,
    });
    expect(fundamentalRatios([year(2024)], null)!.priceToEarnings).toBeNull();
    expect(fundamentalRatios([year(2024), year(2022)], 10)!.revenueGrowth).toBeNull(); // gap year
    expect(fundamentalRatios([], 10)).toBeNull();
  });

  it("handles a revenue decline and zero revenue without dividing by zero", () => {
    close(fundamentalRatios([year(2023), year(2024, { revenue: 900 })], 1)!.revenueGrowth, -0.1);
    expect(fundamentalRatios([year(2024, { revenue: 0 })], 1)!.netMargin).toBeNull();
  });
});
