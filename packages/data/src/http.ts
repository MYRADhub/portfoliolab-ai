import { ProviderError } from "./providers/types";

export interface FetchJsonOptions {
  provider: string;
  fetchImpl?: typeof fetch;
  retries?: number;
  baseDelayMs?: number;
  /** Extra request headers, for example a User-Agent. */
  headers?: Record<string, string>;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET JSON with exponential backoff on 429 and 5xx. Honors Retry-After (seconds) when present. */
export async function fetchJson(url: string, opts: FetchJsonOptions): Promise<unknown> {
  const {
    provider,
    fetchImpl = fetch,
    retries = 3,
    baseDelayMs = 500,
    headers,
    sleep = defaultSleep,
  } = opts;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, headers ? { headers } : undefined);
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new ProviderError(provider, "response was not valid JSON", "bad_response");
      }
    }
    if (res.status === 404) throw new ProviderError(provider, "not found", "not_found");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) throw new ProviderError(provider, `HTTP ${res.status}`, "bad_response");
    if (attempt >= retries) {
      throw new ProviderError(
        provider,
        `HTTP ${res.status} after ${attempt + 1} attempts`,
        res.status === 429 ? "rate_limited" : "unavailable",
      );
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : baseDelayMs * 2 ** attempt,
    );
  }
}
