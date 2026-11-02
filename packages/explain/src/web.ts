import OpenAI from "openai";
import { DEFAULT_EXPLAIN_MODEL } from "./generator";

/** One page excerpt returned by a web search. `snippet` is the page's own text, cleaned of tool markup. */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  /** As the search tool words it, for example "2 days ago". */
  published?: string;
  /** Exact time (ISO) when the tool states one. */
  publishedAt?: string;
}

export interface WebSearcher {
  search(query: string, signal?: AbortSignal): Promise<WebResult[]>;
  /** Opens one page and returns excerpts from it, centred on `focus` when given. */
  open(url: string, focus?: string, signal?: AbortSignal): Promise<WebResult[]>;
}

export const WEB_SNIPPET_MAX = 900;
export const WEB_RESULTS_MAX = 6;

/**
 * Removes the search tool's markup from an excerpt: citation tokens, word limits, crawl metadata and line-number
 * prefixes. What stays is the page's own text, so numbers in it can be checked against the answer.
 */
export function cleanSnippet(raw: string): {
  text: string;
  published?: string;
  publishedAt?: string;
} {
  let s = raw
    // Citation markers like "citeturn305141search0", sometimes wrapped in private-use characters.
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/\b(?:cite)?turn\d+(?:search|view|news|open|fetch|find|image)\d+\b/g, " ")
    .replace(/\[wordlim:\s*\d+\]/gi, " ");
  let published: string | undefined;
  let publishedAt: string | undefined;
  // A metadata preamble of "Key: value;" pairs comes first: keep the publication date, drop the rest.
  const meta =
    /^\s*((?:(?:Published|Date|Crawled|Content type|Source|Total lines|Updated):[^;\n]*;?\s*)+)/i.exec(
      s,
    );
  if (meta) {
    const pub = /Published:\s*([^;\n]+)/i.exec(meta[1]!);
    if (pub) published = pub[1]!.trim();
    // "Date: Fri Oct 30 14:21:58 2026 UTC"
    const exact = /Date:\s*\w{3} (\w{3}) (\d{1,2}) ([\d:]{8}) (\d{4}) UTC/i.exec(meta[1]!);
    if (exact) {
      const t = Date.parse(`${exact[1]} ${exact[2]} ${exact[4]} ${exact[3]} UTC`);
      if (Number.isFinite(t)) publishedAt = new Date(t).toISOString();
    }
    s = s.slice(meta[0].length);
  }
  s = s
    .replace(/^\s*Total lines:\s*\d+\s*$/gim, " ")
    .replace(/^\s*L\d+:\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > WEB_SNIPPET_MAX) s = `${s.slice(0, WEB_SNIPPET_MAX).replace(/\s+\S*$/, "")} ...`;
  return { text: s, ...(published ? { published } : {}), ...(publishedAt ? { publishedAt } : {}) };
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface RawResult {
  type?: string;
  snippet?: string;
  title?: string;
  url?: string;
}
interface RawCall {
  type: string;
  action?: { type?: string; url?: string };
  results?: RawResult[];
}

/** Excerpts from every web_search_call in a response, de-duplicated by URL, page order kept. */
export function resultsFromOutput(output: readonly unknown[], max = WEB_RESULTS_MAX): WebResult[] {
  const out: WebResult[] = [];
  const seen = new Set<string>();
  for (const item of output as RawCall[]) {
    if (item?.type !== "web_search_call") continue;
    for (const r of item.results ?? []) {
      const url = r.url ?? item.action?.url;
      if (!url || !r.snippet || seen.has(url) || !/^https?:\/\//.test(url)) continue;
      const { text, published, publishedAt } = cleanSnippet(r.snippet);
      if (text.length < 40) continue;
      seen.add(url);
      out.push({
        title: (r.title ?? domainOf(url)).trim(),
        url,
        snippet: text,
        ...(published ? { published } : {}),
        ...(publishedAt ? { publishedAt } : {}),
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * Web search through the OpenAI hosted tool. A separate small request runs the search and the raw results are kept;
 * the model's own summary of them is thrown away, so only page text can become a fact.
 */
export class OpenAIWebSearcher implements WebSearcher {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string = DEFAULT_EXPLAIN_MODEL,
  ) {}

  private async run(input: string, signal?: AbortSignal): Promise<WebResult[]> {
    const response = await this.client.responses.create(
      {
        model: this.model,
        input,
        tools: [{ type: "web_search", search_context_size: "medium" }],
        tool_choice: "required",
        include: ["web_search_call.results" as OpenAI.Responses.ResponseIncludable],
        store: false,
      },
      { signal },
    );
    return resultsFromOutput(response.output);
  }

  search(query: string, signal?: AbortSignal): Promise<WebResult[]> {
    return this.run(
      `Search the web for: ${query}\nPrefer primary sources (company releases, filings, regulators) and reputable financial press. When done, reply only with the word done.`,
      signal,
    );
  }

  /** Like search, but asks for news outlets and dated articles rather than reference pages. */
  searchNews(query: string, signal?: AbortSignal): Promise<WebResult[]> {
    return this.run(
      `Search recent news for: ${query}\nPrefer dated articles from reputable news outlets (for example Reuters, AP, Bloomberg, CNBC, The Wall Street Journal, Financial Times, MarketWatch, Barron's) and company press releases. Avoid quote pages, profiles and undated pages. When done, reply only with the word done.`,
      signal,
    );
  }

  open(url: string, focus?: string, signal?: AbortSignal): Promise<WebResult[]> {
    return this.run(
      `Open this page and read it: ${url}${focus ? `\nLook for: ${focus}` : ""}\nWhen done, reply only with the word done.`,
      signal,
    );
  }
}

export function createOpenAIWebSearcher(apiKey: string, model?: string): OpenAIWebSearcher {
  return new OpenAIWebSearcher(new OpenAI({ apiKey }), model);
}
