import { ProviderError, type DailyBar, type PriceProvider } from "./types";

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32) so fixtures are reproducible. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic synthetic prices for local development and tests. Never use for analysis. */
export class FixtureProvider implements PriceProvider {
  readonly name = "fixture";

  constructor(private readonly knownTickers?: readonly string[]) {}

  async getDailyBars(ticker: string, from: string, to: string): Promise<DailyBar[]> {
    if (this.knownTickers && !this.knownTickers.includes(ticker)) {
      throw new ProviderError(this.name, `unknown ticker ${ticker}`, "not_found");
    }
    const next = rng(hash(ticker));
    let price = 50 + (hash(ticker) % 200);
    const bars: DailyBar[] = [];
    const end = new Date(`${to}T00:00:00Z`);
    // Walk from a fixed epoch so a given date always has the same price regardless of `from`.
    for (
      let d = new Date("2015-01-01T00:00:00Z");
      d <= end;
      d = new Date(d.getTime() + 86_400_000)
    ) {
      if (!isWeekday(d)) continue;
      price *= 1 + (next() - 0.48) * 0.04;
      const date = d.toISOString().slice(0, 10);
      if (date >= from) {
        const p = Math.round(price * 100) / 100;
        bars.push({ date, open: p, high: p, low: p, close: p, adjClose: p, volume: 1_000_000 });
      }
    }
    return bars;
  }
}
