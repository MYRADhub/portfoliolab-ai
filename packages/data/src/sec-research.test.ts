import { describe, expect, it } from "vitest";
import { filingSectionText, parseFullTextHits, recentFilings } from "./sec/research";

const words = (n: number, w: string) => Array.from({ length: n }, () => w).join(" ");

describe("recentFilings", () => {
  const raw = {
    filings: {
      recent: {
        accessionNumber: ["0001-26-000003", "0001-26-000002", "0001-26-000001", "0001-25-000009"],
        filingDate: ["2026-08-27", "2026-08-26", "2026-05-28", "2026-02-25"],
        form: ["10-Q", "8-K", "10-K/A", "10-K"],
        primaryDocument: ["q.htm", "e.htm", "a.htm", "k.htm"],
        reportDate: ["2026-07-26", "", "", "2026-01-25"],
        primaryDocDescription: ["10-Q", "8-K", "", "10-K"],
        items: ["", "2.02,9.01", "", ""],
      },
    },
  };

  it("keeps the asked forms newest first, drops amendments and builds archive URLs", () => {
    const r = recentFilings(raw, "0001045810", ["10-K", "10-Q", "8-K"], 10);
    expect(r.map((f) => f.form)).toEqual(["10-Q", "8-K", "10-K"]);
    expect(r[0]!.url).toBe("https://www.sec.gov/Archives/edgar/data/1045810/000126000003/q.htm");
    expect(r[0]!.reportDate).toBe("2026-07-26");
    expect(r[1]!.reportDate).toBeNull();
    expect(r[1]!.description).toBe("8-K, items 2.02,9.01");
  });

  it("respects the limit and rejects an unexpected shape", () => {
    expect(recentFilings(raw, "1", ["10-K", "10-Q", "8-K"], 1)).toHaveLength(1);
    expect(() => recentFilings({}, "1", ["10-K"])).toThrow(/submissions shape/);
  });
});

describe("filingSectionText", () => {
  const tenK = `<html><body>
<p>Item 7. Management's Discussion and Analysis 41</p>
<p>Item 1. Business</p><p>${words(200, "chips")}</p>
<p>Item 1A. Risk Factors</p><p>${words(200, "risk")}</p>
<p>Item 1B. Unresolved Staff Comments</p><p>None.</p>
<p>Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations</p><p>${words(200, "revenue")}</p>
<p>Item 7A. Quantitative and Qualitative Disclosures About Market Risk</p><p>${words(50, "rates")}</p>
</body></html>`;

  it("finds 10-K business, risk factors and MD&A by heading, skipping table-of-contents lines", () => {
    const b = filingSectionText(tenK, "10-K", "business");
    expect(b.found).toBe(true);
    expect(b.text).toMatch(/^chips/);
    expect(b.text).not.toContain("risk");
    expect(filingSectionText(tenK, "10-K", "risk_factors").text).toMatch(/^risk( risk)+$/);
    const m = filingSectionText(tenK, "10-K", "mdna");
    expect(m.found).toBe(true);
    expect(m.text).toMatch(/^revenue/);
    expect(m.text).not.toContain("rates");
  });

  it("finds 10-Q MD&A under Item 2", () => {
    const q = `<p>Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations</p><p>${words(200, "growth")}</p><p>Item 3. Quantitative and Qualitative Disclosures</p><p>x</p>`;
    const r = filingSectionText(q, "10-Q", "mdna");
    expect(r).toEqual({ text: words(200, "growth"), found: true });
  });

  it("falls back to the whole document when the heading is missing or the form has no rule", () => {
    const r = filingSectionText("<p>Just a press release with numbers 12.5%.</p>", "8-K", "mdna");
    expect(r.found).toBe(false);
    expect(r.text).toBe("Just a press release with numbers 12.5%.");
    expect(filingSectionText("<p>x</p>", "10-K", "all")).toEqual({ text: "x", found: true });
  });
});

describe("parseFullTextHits", () => {
  const raw = {
    hits: {
      total: { value: 345 },
      hits: [
        {
          _id: "0000050863-26-000011:intc-20251227.htm",
          _source: {
            ciks: ["0000050863"],
            display_names: ["INTEL CORP  (INTC)  (CIK 0000050863)"],
            form: "10-K",
            file_date: "2026-01-23",
            period_ending: "2025-12-27",
            adsh: "0000050863-26-000011",
          },
        },
        {
          _id: "0000050863-26-000011:ex21.htm",
          _source: {
            ciks: ["0000050863"],
            display_names: ["INTEL CORP  (INTC)  (CIK 0000050863)"],
            form: "10-K",
            file_date: "2026-01-23",
            adsh: "0000050863-26-000011",
          },
        },
        {
          _id: "0001-26-1:x.htm",
          _source: {
            ciks: ["0000000001"],
            display_names: ["Private Co  (CIK 0000000001)"],
            form: "S-1",
            file_date: "2026-03-01",
            period_ending: null,
            adsh: "0001-26-1",
          },
        },
      ],
    },
  };

  it("returns one hit per filing with company, ticker and URL", () => {
    const r = parseFullTextHits(raw);
    expect(r.total).toBe(345);
    expect(r.hits).toEqual([
      {
        company: "INTEL CORP",
        ticker: "INTC",
        cik: "0000050863",
        form: "10-K",
        filingDate: "2026-01-23",
        periodEnding: "2025-12-27",
        url: "https://www.sec.gov/Archives/edgar/data/50863/000005086326000011/intc-20251227.htm",
      },
      {
        company: "Private Co",
        ticker: null,
        cik: "0000000001",
        form: "S-1",
        filingDate: "2026-03-01",
        periodEnding: null,
        url: "https://www.sec.gov/Archives/edgar/data/1/0001261/x.htm",
      },
    ]);
  });

  it("rejects an unexpected shape", () => {
    expect(() => parseFullTextHits({ nope: 1 })).toThrow(/full-text/);
  });
});
