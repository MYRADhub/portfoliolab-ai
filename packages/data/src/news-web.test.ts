import { describe, expect, it } from "vitest";
import { parsePublished, WebNewsProvider, type WebNewsResult } from "./news/web";

const now = new Date("2026-11-01T12:00:00Z");

describe("parsePublished", () => {
  it("reads relative and absolute dates and gives up on anything else", () => {
    expect(parsePublished("2 days ago", now)!.toISOString()).toBe("2026-10-30T12:00:00.000Z");
    expect(parsePublished("an hour ago", now)!.toISOString()).toBe("2026-11-01T11:00:00.000Z");
    expect(parsePublished("3 Weeks ago", now)!.toISOString()).toBe("2026-10-11T12:00:00.000Z");
    expect(parsePublished("yesterday", now)!.toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(parsePublished("Fri Oct 30 14:21:58 2026 UTC", now)!.toISOString()).toBe(
      "2026-10-30T14:21:58.000Z",
    );
    expect(parsePublished("2026-10-29", now)!.toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(parsePublished("recently", now)).toBeNull();
    expect(parsePublished(undefined, now)).toBeNull();
  });
});

describe("WebNewsProvider", () => {
  it("keeps dated results in range, names the outlet, and does not tag the queried ticker", async () => {
    const queries: string[] = [];
    const results: WebNewsResult[] = [
      {
        title: "Nvidia beats",
        url: "https://www.reuters.com/a?utm_source=x",
        snippet: "Revenue rose.",
        published: "2 days ago",
      },
      {
        title: "Old story",
        url: "https://example.com/old",
        snippet: "Old.",
        published: "3 months ago",
      },
      { title: "Undated page", url: "https://example.com/undated", snippet: "No date." },
      {
        title: "Exact",
        url: "https://apnews.com/b",
        snippet: "Exact date.",
        publishedAt: "2026-10-31T09:00:00Z",
      },
    ];
    const p = new WebNewsProvider(
      { search: async (q) => (queries.push(q), results) },
      new Map([["NVDA", "NVIDIA Corp"]]),
      () => now,
    );
    expect(p.tagsQueriedTicker).toBe(false);
    const out = await p.getCompanyNews("NVDA", "2026-10-25", "2026-11-01");
    expect(queries[0]).toMatch(
      /^NVIDIA Corp \(NVDA\) stock news between 2026-10-25 and 2026-11-01/,
    );
    expect(out.map((a) => [a.title, a.sourceName, a.tickers])).toEqual([
      ["Nvidia beats", "reuters.com", []],
      ["Exact", "apnews.com", []],
    ]);
    expect(out[0]!.url).not.toContain("utm_source");
    expect(out[0]!.providerId).toHaveLength(32);
  });
});
