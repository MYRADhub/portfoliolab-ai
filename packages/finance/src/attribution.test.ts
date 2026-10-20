import { describe, expect, it } from "vitest";
import { dayContributions, groupContributions, portfolioReturns } from "./index";

const close = (a: number, b: number, tol = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("dayContributions", () => {
  const weights = [0.5, 0.3, 0.2];
  const returns = [
    [0.01, -0.02, 0.03],
    [0.0, -0.04, 0.01],
    [-0.01, 0.02, 0.0],
  ];

  it("multiplies weight by return", () => {
    const c = dayContributions(weights, returns, 1);
    close(c[0]!.contribution, 0.5 * -0.02);
    close(c[1]!.contribution, 0.3 * -0.04);
    close(c[2]!.contribution, 0.2 * 0.02);
    expect(c.map((x) => x.index)).toEqual([0, 1, 2]);
  });

  it("sums exactly to the portfolio return on every day", () => {
    const pr = portfolioReturns(weights, returns);
    for (let t = 0; t < 3; t++) {
      close(
        dayContributions(weights, returns, t).reduce((a, c) => a + c.contribution, 0),
        pr[t]!,
      );
    }
  });

  it("rejects mismatched inputs and out-of-range days", () => {
    expect(() => dayContributions([1], returns, 0)).toThrow(/mismatch/);
    expect(() => dayContributions(weights, returns, 9)).toThrow(/no return/);
  });
});

describe("groupContributions", () => {
  it("sums by group, orders by size and expresses shares of the total", () => {
    const r = groupContributions([
      { group: "Tech", contribution: -0.01 },
      { group: "Tech", contribution: -0.006 },
      { group: "Financials", contribution: 0.002 },
      { group: "Energy", contribution: -0.001 },
    ]);
    close(r.total, -0.015);
    expect(r.groups.map((g) => g.group)).toEqual(["Tech", "Financials", "Energy"]);
    close(r.groups[0]!.share!, 0.016 / 0.015);
    close(r.groups[1]!.share!, -0.002 / 0.015); // moved against the portfolio
    close(
      r.groups.reduce((a, g) => a + g.share!, 0),
      1,
    );
  });

  it("gives no share when the total move is too small to divide by", () => {
    const r = groupContributions([
      { group: "A", contribution: 0.01 },
      { group: "B", contribution: -0.0099 },
    ]);
    expect(r.groups.every((g) => g.share === null)).toBe(true);
  });

  it("breaks ties by name and handles no input", () => {
    expect(
      groupContributions([
        { group: "B", contribution: 0.01 },
        { group: "A", contribution: 0.01 },
      ]).groups.map((g) => g.group),
    ).toEqual(["A", "B"]);
    expect(groupContributions([])).toEqual({ total: 0, groups: [] });
  });
});
