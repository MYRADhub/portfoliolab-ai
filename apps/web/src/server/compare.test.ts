import { describe, expect, it } from "vitest";
import { describeDifferences, type CompareSide } from "./compare";

const side = (over: Partial<CompareSide> = {}): CompareSide => ({
  id: "x",
  name: "A",
  holdings: 5,
  annualReturn: 0.1,
  volatility: 0.2,
  maxDrawdown: -0.2,
  sharpe: 0.5,
  effectiveSectors: 3,
  effectiveFactors: 5,
  topForce: { name: "Interest rates", share: 0.3 },
  beta: 1,
  ...over,
});

const base = { overlap: { sharedWeight: 0.5, shared: [] }, correlation: 0.7 };

describe("describeDifferences", () => {
  it("says who returned more and who was more volatile, in points", () => {
    const d = describeDifferences({
      ...base,
      a: side({ name: "Calm" }),
      b: side({ name: "Bold", annualReturn: 0.152, volatility: 0.31 }),
    });
    expect(d[0]).toBe(
      "Over this period Bold returned 5.2 points a year more than Calm, with 11.0 points more volatility.",
    );
    const flipped = describeDifferences({
      ...base,
      a: side({ name: "Calm" }),
      b: side({ name: "Bold", annualReturn: 0.05, volatility: 0.15 }),
    });
    expect(flipped[0]).toContain(
      "5.0 points a year less than Calm, with 5.0 points less volatility",
    );
  });

  it("mentions a deeper worst fall only when the gap is at least one point", () => {
    const small = describeDifferences({
      ...base,
      a: side(),
      b: side({ name: "B", maxDrawdown: -0.205 }),
    });
    expect(small.some((s) => s.includes("worst fall"))).toBe(false);
    const big = describeDifferences({
      ...base,
      a: side(),
      b: side({ name: "B", maxDrawdown: -0.35 }),
    });
    expect(big.find((s) => s.includes("worst fall"))).toBe(
      "B's worst fall was deeper: -35.0% against -20.0%.",
    );
  });

  it("compares hidden concentration only when both have exposure data, and treats small gaps as the same", () => {
    const same = describeDifferences({
      ...base,
      a: side({ effectiveFactors: 5 }),
      b: side({ name: "B", effectiveFactors: 5.2 }),
    });
    expect(same.find((s) => s.includes("independent economic forces"))).toContain(
      "about the same number",
    );
    const more = describeDifferences({
      ...base,
      a: side({ effectiveFactors: 4 }),
      b: side({ name: "B", effectiveFactors: 7 }),
    });
    expect(more.find((s) => s.includes("more economic forces"))).toBe(
      "B is spread across more economic forces: 7.0 against 4.0.",
    );
    const none = describeDifferences({
      ...base,
      a: side({ effectiveFactors: null, topForce: null }),
      b: side({ name: "B" }),
    });
    expect(none.some((s) => s.includes("economic force"))).toBe(false);
  });

  it("names the shared or different biggest force", () => {
    const shared = describeDifferences({
      ...base,
      a: side(),
      b: side({ name: "B", topForce: { name: "Interest rates", share: 0.4 } }),
    });
    expect(shared.find((s) => s.includes("same force"))).toContain(
      "Interest rates (30% and 40% of exposure)",
    );
    const diff = describeDifferences({
      ...base,
      a: side(),
      b: side({ name: "B", topForce: { name: "Oil price", share: 0.25 } }),
    });
    expect(diff.find((s) => s.includes("leans most on"))).toBe(
      "A leans most on Interest rates (30%); B on Oil price (25%).",
    );
  });

  it("describes beta, overlap and correlation", () => {
    const d = describeDifferences({
      a: side(),
      b: side({ name: "B", beta: 1.4 }),
      overlap: { sharedWeight: 0.6, shared: [] },
      correlation: 0.95,
    });
    expect(d).toContain("B moves more with the market: beta 1.40 against 1.00.");
    expect(d).toContain("60% of the money sits in companies both hold.");
    expect(d.at(-1)).toBe("Their daily returns have moved almost in lockstep (correlation 0.95).");
    const none = describeDifferences({
      a: side(),
      b: side({ name: "B" }),
      overlap: { sharedWeight: 0, shared: [] },
      correlation: 0.2,
    });
    expect(none).toContain("They share almost no holdings.");
    expect(none.at(-1)).toContain("fairly independently");
    expect(
      describeDifferences({
        a: side(),
        b: side({ name: "B" }),
        overlap: { sharedWeight: 0.1, shared: [] },
        correlation: null,
      }).some((s) => s.includes("correlation")),
    ).toBe(false);
  });
});
