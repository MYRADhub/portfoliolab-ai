import { describe, expect, it } from "vitest";
import { pickGoldSet } from "./gold";

describe("pickGoldSet", () => {
  const rows = [
    { ticker: "A1", sector: "Energy", dollarVolume: 5 },
    { ticker: "A2", sector: "Energy", dollarVolume: 9 },
    { ticker: "A3", sector: "Energy", dollarVolume: 1 },
    { ticker: "B1", sector: "Banks", dollarVolume: 3 },
    { ticker: "B2", sector: "Banks", dollarVolume: 3 },
    { ticker: "X", sector: null, dollarVolume: 100 },
    { ticker: "Z", sector: "Banks", dollarVolume: 0 },
  ];

  it("takes the most traded per sector, sectors in order, ties by ticker", () => {
    expect(pickGoldSet(rows, 2)).toEqual(["B1", "B2", "A2", "A1"]);
  });

  it("skips companies without a sector or trading data and copes with small sectors", () => {
    const got = pickGoldSet(rows, 3);
    expect(got).toEqual(["B1", "B2", "A2", "A1", "A3"]);
    expect(got).not.toContain("X");
    expect(got).not.toContain("Z");
  });

  it("keeps only the most traded share class of one issuer", () => {
    const classes = [
      { ticker: "GOOGL", sector: "Comm", issuer: "1", dollarVolume: 9 },
      { ticker: "GOOG", sector: "Comm", issuer: "1", dollarVolume: 8 },
      { ticker: "META", sector: "Comm", issuer: "2", dollarVolume: 7 },
    ];
    expect(pickGoldSet(classes, 2)).toEqual(["GOOGL", "META"]);
  });

  it("rejects a bad size", () => {
    expect(() => pickGoldSet(rows, 0)).toThrow();
    expect(() => pickGoldSet(rows, 1.5)).toThrow();
  });
});
