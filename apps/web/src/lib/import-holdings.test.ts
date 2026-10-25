import { describe, expect, it } from "vitest";
import { normalizeTicker, parseAmount, parseHoldings } from "./import-holdings";

describe("normalizeTicker", () => {
  it("cleans the ways brokers write tickers and share classes", () => {
    expect(normalizeTicker(" aapl ")).toBe("AAPL");
    expect(normalizeTicker("$MSFT")).toBe("MSFT");
    expect(normalizeTicker("NASDAQ:NVDA")).toBe("NVDA");
    expect(normalizeTicker("BRK-B")).toBe("BRK.B");
    expect(normalizeTicker("BRK/B")).toBe("BRK.B");
    expect(normalizeTicker("BRK B")).toBe("BRK.B");
    expect(normalizeTicker("BF.B")).toBe("BF.B");
    expect(normalizeTicker("SPAXX**")).toBe("SPAXX");
  });

  it("rejects things that are not tickers", () => {
    for (const bad of ["", "Apple Inc", "123", "TOOLONGTICKER", "A$B", "12AB"])
      expect(normalizeTicker(bad), bad).toBeNull();
  });
});

describe("parseAmount", () => {
  it("reads numbers as people write them", () => {
    expect(parseAmount("25")).toEqual({ value: 25, percent: false, dollar: false });
    expect(parseAmount("12.5%")).toEqual({ value: 12.5, percent: true, dollar: false });
    expect(parseAmount("$1,234.50")).toEqual({ value: 1234.5, percent: false, dollar: true });
    expect(parseAmount("1,234")?.value).toBe(1234);
    expect(parseAmount("(300)")?.value).toBe(-300);
    expect(parseAmount("12,5")?.value).toBe(12.5); // decimal comma
    expect(parseAmount("-4")?.value).toBe(-4);
  });

  it("returns null for anything else", () => {
    for (const bad of ["", "abc", "1.2.3", "--", "n/a"]) expect(parseAmount(bad), bad).toBeNull();
  });
});

describe("parseHoldings", () => {
  it("reads a plain list of percentages", () => {
    const r = parseHoldings("AAPL 25%\nMSFT 25%\nNVDA 50%");
    expect(r.kind).toBe("weights");
    expect(r.holdings).toEqual([
      { ticker: "AAPL", amount: 25 },
      { ticker: "MSFT", amount: 25 },
      { ticker: "NVDA", amount: 50 },
    ]);
    expect(r.skipped).toEqual([]);
  });

  it("calls plain numbers weights when they add up to 100, and share counts otherwise", () => {
    expect(parseHoldings("AAPL 60\nMSFT 40").kind).toBe("weights");
    expect(parseHoldings("AAPL 10\nMSFT 5\nNVDA 3").kind).toBe("shares");
    expect(parseHoldings("AAPL 150\nMSFT 80").kind).toBe("shares"); // one is above 100 and they do not add to 100
  });

  it("calls dollar amounts values", () => {
    const r = parseHoldings("AAPL $5,000\nMSFT $3,000.50");
    expect(r.kind).toBe("values");
    expect(r.holdings).toEqual([
      { ticker: "AAPL", amount: 5000 },
      { ticker: "MSFT", amount: 3000.5 },
    ]);
  });

  it("reads CSV with commas, semicolons and tabs", () => {
    expect(parseHoldings("AAPL,10\nMSFT,5").holdings.map((h) => h.amount)).toEqual([10, 5]);
    expect(parseHoldings("AAPL;10\nMSFT;5").holdings.map((h) => h.amount)).toEqual([10, 5]);
    expect(parseHoldings("AAPL\t10\nMSFT\t5").holdings.map((h) => h.amount)).toEqual([10, 5]);
  });

  it("uses the header to find the ticker and the right column, preferring weights, then values, then shares", () => {
    const csv =
      'Symbol,Description,Quantity,Last Price,Market Value\nAAPL,Apple Inc,10,200,"$2,000.00"\nMSFT,Microsoft,5,400,"$2,000.00"';
    const r = parseHoldings(csv);
    expect(r.kind).toBe("values");
    expect(r.holdings).toEqual([
      { ticker: "AAPL", amount: 2000 },
      { ticker: "MSFT", amount: 2000 },
    ]);
    const shares = parseHoldings("Ticker,Shares\nAAPL,10\nMSFT,5");
    expect(shares.kind).toBe("shares");
    const w = parseHoldings("Symbol,Shares,Weight %\nAAPL,10,60\nMSFT,5,40");
    expect(w.kind).toBe("weights");
    expect(w.holdings.map((h) => h.amount)).toEqual([60, 40]);
  });

  it("skips cash, totals, footers, short positions and unreadable lines, saying why", () => {
    const r = parseHoldings(
      [
        "Symbol,Quantity",
        "AAPL,10",
        "CASH,500",
        "Total,510",
        "TSLA,(5)",
        "MSFT,",
        "Apple Inc,3",
        "NVDA,0",
      ].join("\n"),
    );
    expect(r.holdings).toEqual([{ ticker: "AAPL", amount: 10 }]);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.text, s.reason]));
    expect(reasons["CASH,500"]).toBe("Not a holding");
    expect(reasons["Total,510"]).toBe("Not a holding");
    expect(reasons["TSLA,(5)"]).toBe("Short or zero positions are not supported");
    expect(reasons["MSFT,"]).toBe("No number found");
    expect(reasons["Apple Inc,3"]).toContain("is not a ticker");
    expect(reasons["NVDA,0"]).toBe("Short or zero positions are not supported");
    expect(r.skipped.find((s) => s.text === "AAPL,10")).toBeUndefined();
  });

  it("adds duplicate tickers together and reports them", () => {
    const r = parseHoldings("AAPL 10\nAAPL 5\nMSFT 3");
    expect(r.holdings).toEqual([
      { ticker: "AAPL", amount: 15 },
      { ticker: "MSFT", amount: 3 },
    ]);
    expect(r.merged).toEqual(["AAPL"]);
  });

  it("handles share classes, a byte-order mark, Windows line endings and blank lines", () => {
    const r = parseHoldings("﻿BRK-B 5\r\n\r\nBF.B 3\r\n");
    expect(r.holdings).toEqual([
      { ticker: "BRK.B", amount: 5 },
      { ticker: "BF.B", amount: 3 },
    ]);
  });

  it("returns an empty result for empty or unreadable input", () => {
    expect(parseHoldings("").holdings).toEqual([]);
    expect(parseHoldings("   \n\n").holdings).toEqual([]);
    const junk = parseHoldings("hello world\nfoo bar");
    expect(junk.holdings).toEqual([]);
    expect(junk.skipped).toHaveLength(2);
  });

  it("reads a headerless line with extra words by taking the first number after the ticker", () => {
    const r = parseHoldings("AAPL shares 10");
    expect(r.holdings).toEqual([{ ticker: "AAPL", amount: 10 }]);
  });
});
