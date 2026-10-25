import { describe, expect, it } from "vitest";
import type { PooledReport } from "./spillover";
import { judgeEarnings, judgeSectors, judgeSpillover } from "./evidence";

const agg = (t: number | null) => ({
  n: 70,
  mean: 0.05,
  sd: 0.1,
  t,
  ci: [0, 0.1] as [number, number],
  sufficient: true,
});

const report = (t: number | null, p: number | null, events = 100): PooledReport =>
  ({
    events,
    clusters: 60,
    clusteredPartial: t === undefined ? null : agg(t),
    placebo: { permutations: 200, pCorrelation: p, pPartial: p, nullMean: 0, nullSd: 0.004 },
    companies: ["A"],
    eventsPerCompany: 12,
    minStocks: 30,
  }) as unknown as PooledReport;

describe("judgeSpillover", () => {
  it("needs both a clear clustered t-statistic and a small placebo p-value", () => {
    expect(judgeSpillover(report(4.1, 0.005))).toBe("supported");
    expect(judgeSpillover(report(4.1, 0.2))).toBe("inconclusive");
    expect(judgeSpillover(report(1.2, 0.001))).toBe("inconclusive");
  });
  it("reports a clearly negative result as not supported, and missing data as no data", () => {
    expect(judgeSpillover(report(-3, 0.9))).toBe("not_supported");
    expect(judgeSpillover(report(null, null))).toBe("no_data");
    expect(judgeSpillover(report(4, 0.001, 0))).toBe("no_data");
  });
});

describe("judgeSectors", () => {
  it("is supported only when exposures win on average and on most days", () => {
    expect(judgeSectors({ exposures: 0.17, sectors: 0.13, daysExposuresBetter: 0.66 })).toBe(
      "supported",
    );
    expect(judgeSectors({ exposures: 0.17, sectors: 0.13, daysExposuresBetter: 0.55 })).toBe(
      "inconclusive",
    );
    expect(judgeSectors({ exposures: 0.1, sectors: 0.13, daysExposuresBetter: 0.7 })).toBe(
      "not_supported",
    );
    expect(judgeSectors({ exposures: 0.13, sectors: 0.13, daysExposuresBetter: 0.9 })).toBe(
      "not_supported",
    );
  });
});

describe("judgeEarnings", () => {
  it("compares the share of unusual days with the 5% expected by chance", () => {
    expect(judgeEarnings(500, 0.55)).toBe("supported");
    expect(judgeEarnings(500, 0.1)).toBe("inconclusive");
    expect(judgeEarnings(500, 0.05)).toBe("not_supported");
  });
  it("needs enough events", () => {
    expect(judgeEarnings(10, 0.9)).toBe("no_data");
    expect(judgeEarnings(500, null)).toBe("no_data");
  });
});
