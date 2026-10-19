export interface DailyBar {
  date: string; // YYYY-MM-DD, exchange trading date
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adjClose: number;
  volume: number | null;
}

export interface PriceProvider {
  readonly name: string;
  /** Daily bars for [from, to] inclusive, ascending by date. Throws ProviderError on failure. */
  getDailyBars(ticker: string, from: string, to: string): Promise<DailyBar[]>;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly kind: "not_found" | "rate_limited" | "unavailable" | "bad_response",
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}
