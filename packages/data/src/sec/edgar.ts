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
}
