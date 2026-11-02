import { fetchJson, fetchText, type FetchJsonOptions } from "../http";

/**
 * Minimal client for SEC EDGAR's public JSON APIs. No key is needed, but the SEC requires a User-Agent that
 * identifies the requester and asks for at most 10 requests per second.
 */
export class EdgarClient {
  constructor(
    private readonly userAgent: string,
    private readonly http: Omit<FetchJsonOptions, "provider" | "headers"> = {},
  ) {
    if (!userAgent.trim()) throw new Error("SEC requires a User-Agent that identifies you");
  }

  private get(url: string): Promise<unknown> {
    return fetchJson(url, {
      ...this.http,
      provider: "sec",
      headers: { "user-agent": this.userAgent, accept: "application/json" },
    });
  }

  submissions(cik: string): Promise<unknown> {
    return this.get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`);
  }

  /** An older page of a company's filing history, named in `filings.files` of its submissions response. */
  submissionsPage(name: string): Promise<unknown> {
    return this.get(`https://data.sec.gov/submissions/${encodeURIComponent(name)}`);
  }

  /** A filing document from the EDGAR archive, as text (usually HTML). */
  document(url: string): Promise<string> {
    return fetchText(url, {
      ...this.http,
      provider: "sec",
      headers: { "user-agent": this.userAgent, accept: "text/html,*/*" },
    });
  }

  companyFacts(cik: string): Promise<unknown> {
    return this.get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`);
  }

  /**
   * EDGAR full-text search over filings since 2001. `forms` limits the form types; dates are YYYY-MM-DD. Returns the
   * raw response; parse it with parseFullTextHits.
   */
  fullTextSearch(
    query: string,
    opts: { forms?: readonly string[]; from?: string; to?: string; ciks?: readonly string[] } = {},
  ): Promise<unknown> {
    const p = new URLSearchParams({ q: query });
    if (opts.forms?.length) p.set("forms", opts.forms.join(","));
    if (opts.ciks?.length) p.set("ciks", opts.ciks.map((c) => c.padStart(10, "0")).join(","));
    if (opts.from || opts.to) {
      p.set("dateRange", "custom");
      // EDGAR ignores a range unless both ends are given.
      p.set("startdt", opts.from ?? "2001-01-01");
      p.set("enddt", opts.to ?? new Date().toISOString().slice(0, 10));
    }
    return this.get(`https://efts.sec.gov/LATEST/search-index?${p.toString()}`);
  }
}
