import { describe, expect, it } from "vitest";
import { judgeDrafts, MIN_BLIND_COMPANIES } from "./evidence";

describe("judgeDrafts", () => {
  const a = (k: number | null, lo: number, companies = 20) => ({
    companies,
    weightedKappa: k,
    kappaInterval: k === null ? null : ([lo, k + 0.1] as [number, number]),
  });

  it("needs enough blind companies and a defined kappa", () => {
    expect(judgeDrafts(a(0.9, 0.8, MIN_BLIND_COMPANIES - 1))).toBe("no_data");
    expect(judgeDrafts(a(null, 0))).toBe("no_data");
  });

  it("calls substantial agreement supported only when the interval also clears 0.4", () => {
    expect(judgeDrafts(a(0.7, 0.5))).toBe("supported");
    expect(judgeDrafts(a(0.7, 0.3))).toBe("inconclusive");
    expect(judgeDrafts(a(0.5, 0.3))).toBe("inconclusive");
    expect(judgeDrafts(a(0.3, 0.1))).toBe("not_supported");
  });
});
