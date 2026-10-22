import { describe, expect, it } from "vitest";
import { layoutGraph } from "./exposure-graph";

const holdings = [
  { ticker: "NVDA", weight: 0.5 },
  { ticker: "AAPL", weight: 0.3 },
  { ticker: "JPM", weight: 0.2 },
];
const factors = [
  { slug: "ai", name: "AI spending", net: 1.5 },
  { slug: "rates", name: "Interest rates", net: -0.3 },
  { slug: "china", name: "China demand", net: 0.9 },
];
const cells = [
  { ticker: "NVDA", factor: "ai", signed: 3 },
  { ticker: "NVDA", factor: "rates", signed: -1 },
  { ticker: "AAPL", factor: "china", signed: 2 },
  { ticker: "AAPL", factor: "rates", signed: -1 },
  { ticker: "JPM", factor: "rates", signed: 2 },
];

describe("layoutGraph", () => {
  const g = layoutGraph(holdings, factors, cells, { height: 400 });
  const node = (id: string) => g.nodes.find((n) => n.id === id)!;

  it("creates one link per non-zero cell, with sign and weight-times-exposure value", () => {
    expect(g.links).toHaveLength(5);
    const nvdaAi = g.links.find((l) => l.holding === "NVDA" && l.factor === "ai")!;
    expect(nvdaAi).toMatchObject({ sign: 1 });
    expect(nvdaAi.value).toBeCloseTo(1.5, 12);
    expect(g.links.find((l) => l.holding === "NVDA" && l.factor === "rates")).toMatchObject({
      sign: -1,
    });
    expect(g.links.find((l) => l.holding === "JPM")!.value).toBeCloseTo(0.4, 12);
  });

  it("makes thickness proportional to value and node height equal to its links' total", () => {
    const [a, b] = [
      g.links.find((l) => l.holding === "NVDA" && l.factor === "ai")!,
      g.links.find((l) => l.holding === "AAPL" && l.factor === "china")!,
    ];
    expect(a.width / b.width).toBeCloseTo(a.value / b.value, 6);
    for (const n of g.nodes) {
      const own = g.links.filter((l) => (n.side === "holding" ? l.holding : l.factor) === n.id);
      expect(n.h).toBeCloseTo(
        own.reduce((s, l) => s + l.width, 0),
        9,
      );
    }
  });

  it("stacks nodes without overlap and keeps every link inside its nodes", () => {
    for (const side of ["holding", "factor"] as const) {
      const col = g.nodes.filter((n) => n.side === side).sort((x, y) => x.y - y.y);
      for (let i = 1; i < col.length; i++)
        expect(col[i]!.y).toBeGreaterThanOrEqual(col[i - 1]!.y + col[i - 1]!.h);
    }
    for (const l of g.links) {
      const h = node(l.holding);
      const f = node(l.factor);
      expect(l.y0 - l.width / 2).toBeGreaterThanOrEqual(h.y - 1e-9);
      expect(l.y0 + l.width / 2).toBeLessThanOrEqual(h.y + h.h + 1e-9);
      expect(l.y1 - l.width / 2).toBeGreaterThanOrEqual(f.y - 1e-9);
      expect(l.y1 + l.width / 2).toBeLessThanOrEqual(f.y + f.h + 1e-9);
    }
  });

  it("fits the requested height and orders holdings by weight and factors by total flow", () => {
    const bottom = Math.max(...g.nodes.map((n) => n.y + n.h));
    expect(bottom).toBeLessThanOrEqual(400 + 1e-6);
    expect(g.nodes.filter((n) => n.side === "holding").map((n) => n.id)).toEqual([
      "NVDA",
      "AAPL",
      "JPM",
    ]);
    expect(g.nodes.filter((n) => n.side === "factor").map((n) => n.id)).toEqual([
      "ai",
      "rates",
      "china",
    ]);
    expect(node("NVDA").weight).toBe(0.5);
    expect(node("rates")).toMatchObject({ label: "Interest rates", net: -0.3 });
  });

  it("skips holdings and factors with no exposure and handles empty or single inputs", () => {
    const partial = layoutGraph(holdings, factors, [
      { ticker: "NVDA", factor: "ai", signed: 2 },
      { ticker: "JPM", factor: "rates", signed: 0 },
    ]);
    expect(partial.nodes.map((n) => n.id).sort()).toEqual(["NVDA", "ai"]);
    expect(layoutGraph(holdings, factors, [])).toEqual({ nodes: [], links: [], height: 440 });
    const one = layoutGraph(
      [holdings[0]!],
      [factors[0]!],
      [{ ticker: "NVDA", factor: "ai", signed: -3 }],
    );
    expect(one.links).toHaveLength(1);
    expect(one.links[0]).toMatchObject({ sign: -1 });
  });

  it("never draws a link thinner than the minimum and still fits when many links are tiny", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ticker: `T${i}`,
      weight: i === 0 ? 0.9 : 0.1 / 11,
    }));
    const f = [{ slug: "a", name: "A", net: 1 }];
    const c = many.map((h) => ({ ticker: h.ticker, factor: "a", signed: 1 }));
    const g2 = layoutGraph(many, f, c, { height: 300, minWidth: 2 });
    expect(Math.min(...g2.links.map((l) => l.width))).toBeGreaterThanOrEqual(2);
    expect(Math.max(...g2.nodes.map((n) => n.y + n.h))).toBeLessThanOrEqual(300 + 1);
  });
});
