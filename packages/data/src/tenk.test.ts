import { describe, expect, it } from "vitest";
import {
  BUSINESS_WORDS,
  extractTenKSections,
  findTenKBefore,
  htmlToText,
  latestTenKBefore,
  quoteAppearsIn,
} from "./index";

const submissions = {
  filings: {
    recent: {
      accessionNumber: ["a-26", "a-25q", "a-25", "a-25amend", "a-24"],
      filingDate: ["2026-02-01", "2025-11-01", "2025-02-03", "2025-03-01", "2024-02-02"],
      acceptanceDateTime: [
        "2026-02-01T21:00:00.000Z",
        "2025-11-01T21:00:00.000Z",
        "2025-02-03T21:00:00.000Z",
        "2025-03-01T21:00:00.000Z",
        "2024-02-02T21:00:00.000Z",
      ],
      form: ["10-K", "10-Q", "10-K", "10-K/A", "10-K"],
      primaryDocument: ["k26.htm", "q.htm", "k25.htm", "k25a.htm", "k24.htm"],
      reportDate: ["2025-12-31", "2025-09-30", "2024-12-31", "2024-12-31", "2023-12-31"],
    },
  },
};

describe("latestTenKBefore", () => {
  it("picks the newest original 10-K filed strictly before the cutoff", () => {
    const k = latestTenKBefore(submissions, "2025-10-24")!;
    expect(k).toMatchObject({
      accession: "a-25",
      primaryDocument: "k25.htm",
      reportDate: "2024-12-31",
    });
    expect(latestTenKBefore(submissions, "2026-02-01")!.accession).toBe("a-25");
    expect(latestTenKBefore(submissions, "2026-02-02")!.accession).toBe("a-26");
  });

  it("returns null when no annual report predates the cutoff, and rejects a malformed response", () => {
    expect(latestTenKBefore(submissions, "2024-01-01")).toBeNull();
    expect(() => latestTenKBefore({ nope: 1 }, "2025-01-01")).toThrow(/unexpected/);
  });
});

describe("htmlToText", () => {
  it("drops hidden XBRL data, scripts and tags, decodes entities and keeps paragraphs", () => {
    const html = `<html><head><title>x</title></head><body><ix:header><ix:hidden>SECRET</ix:hidden></ix:header>
      <script>var a=1;</script><p>We&#8217;re a <b>chip</b>&nbsp;maker &amp; designer.</p><div>Second&#x2014;line</div></body></html>`;
    expect(htmlToText(html)).toBe("We're a chip maker & designer.\nSecond-line");
  });
});

const filing = (business: string, risks: string) => `
  <p>Table of contents</p>
  <p>Item 1. Business</p><p>4</p><p>Item 1A. Risk Factors</p><p>12</p><p>Item 1B. Unresolved Staff Comments</p>
  <p>PART I</p>
  <p>ITEM 1. BUSINESS</p><p>${business}</p>
  <p>ITEM 1A. RISK FACTORS</p><p>${risks}</p>
  <p>ITEM 1B. UNRESOLVED STAFF COMMENTS</p><p>None.</p>
  <p>ITEM 2. PROPERTIES</p><p>Offices.</p>`;

describe("extractTenKSections", () => {
  it("takes the body sections, not the table of contents entries", () => {
    const s = extractTenKSections(
      filing(
        "We design graphics processors sold to data center operators worldwide.",
        "Demand for our products depends on capital spending by cloud providers.",
      ),
    );
    expect(s.business).toBe(
      "We design graphics processors sold to data center operators worldwide.",
    );
    expect(s.risks).toBe("Demand for our products depends on capital spending by cloud providers.");
  });

  it("cuts a long section to its first words and returns empty text without standard headings", () => {
    const long = Array.from({ length: BUSINESS_WORDS + 500 }, (_, i) => `w${i}`).join(" ");
    const s = extractTenKSections(filing(long, "Risks are described here in plain words."));
    expect(s.business.split(" ")).toHaveLength(BUSINESS_WORDS);
    expect(s.business.endsWith(`w${BUSINESS_WORDS - 1}`)).toBe(true);
    expect(extractTenKSections("<p>No headings at all.</p>")).toEqual({ business: "", risks: "" });
  });
});

describe("extractTenKSections fallback", () => {
  it("uses the overview and 'Risks related to' headings when the body has no Item headings", () => {
    const body = Array.from({ length: 200 }, (_, i) => `b${i}`).join(" ");
    const risk = Array.from({ length: 200 }, (_, i) => `r${i}`).join(" ");
    const html = `<p>ITEM 1.</p><p>BUSINESS</p><p>5</p><p>ITEM 1A.</p><p>RISK FACTORS</p><p>16</p><p>ITEM 1B.</p><p>UNRESOLVED STAFF COMMENTS</p><p>49</p><p>Introduction</p><p>5</p>
      <p>Introduction</p><p>${body}</p><p>Risks Related to Our Operations</p><p>${risk}</p>`;
    const s = extractTenKSections(html);
    expect(s.business.startsWith("b0 b1")).toBe(true);
    expect(s.risks.startsWith("Risks Related to Our Operations")).toBe(true);
    expect(s.risks).toContain("r199");
  });
});

describe("quoteAppearsIn", () => {
  const source =
    "Our revenue depends on data center customers.\nA rise in interest rates may reduce demand.";
  it("matches word for word despite case, spacing, punctuation and line breaks", () => {
    expect(quoteAppearsIn("our revenue depends on data center customers", source)).toBe(true);
    expect(quoteAppearsIn("customers. A rise in   INTEREST rates", source)).toBe(true);
    expect(quoteAppearsIn("“A rise in interest rates may reduce demand.”", source)).toBe(true);
  });

  it("rejects paraphrases, invented text and quotes too short to be evidence", () => {
    expect(quoteAppearsIn("Higher interest rates may reduce demand for our products", source)).toBe(
      false,
    );
    expect(quoteAppearsIn("data center customers", source)).toBe(false);
    expect(quoteAppearsIn("", source)).toBe(false);
  });
});

describe("findTenKBefore", () => {
  it("looks into older history pages when the recent filings hold no annual report", async () => {
    const recent = {
      filings: {
        recent: { ...submissions.filings.recent, form: ["8-K", "8-K", "8-K", "8-K", "8-K"] },
        files: [
          { name: "CIK1-submissions-002.json", filingFrom: "2026-01-01" },
          { name: "CIK1-submissions-001.json", filingFrom: "2024-01-01" },
        ],
      },
    };
    const pages: string[] = [];
    const edgar = {
      submissions: async () => recent,
      submissionsPage: async (name: string) => {
        pages.push(name);
        return submissions.filings.recent;
      },
    };
    expect((await findTenKBefore(edgar, "1", "2025-10-24"))!.accession).toBe("a-25");
    // the page that starts after the cutoff is never fetched
    expect(pages).toEqual(["CIK1-submissions-001.json"]);
  });
});
