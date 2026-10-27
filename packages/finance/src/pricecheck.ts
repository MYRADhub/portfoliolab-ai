/** Ranks from 1, ties sharing the average of the ranks they span. */
export function ranks(xs: readonly number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]![1]] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation; null with fewer than 3 points or when either side is constant. */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length) throw new Error("x and y must have the same length");
  if (x.length < 3) return null;
  const rx = ranks(x);
  const ry = ranks(y);
  const n = x.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i]! - mx) * (ry[i]! - my);
    sxx += (rx[i]! - mx) ** 2;
    syy += (ry[i]! - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

export interface Sensitivity {
  /** Extra return of the stock per unit of the signal's return beyond what the market explains. */
  beta: number;
  /** beta divided by its standard error. Beyond 2 in size, the stock reliably moved with (or against) the signal. */
  t: number;
  n: number;
}

/**
 * How a stock moved with a signal beyond the market: the signal is first stripped of the part the market explains,
 * then the stock is regressed on the market and that remainder. Without this step every signal would look like the
 * market, since most funds rise and fall with it. Null with fewer than 30 days or a signal the market fully explains.
 */
export function proxySensitivity(
  stock: readonly number[],
  market: readonly number[],
  signal: readonly number[],
): Sensitivity | null {
  const n = stock.length;
  if (market.length !== n || signal.length !== n)
    throw new Error("series must have the same length");
  if (n < 30) return null;
  const avg = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / n;
  const mm = avg(market);
  const ms = avg(signal);
  let smm = 0;
  let sms = 0;
  for (let i = 0; i < n; i++) {
    smm += (market[i]! - mm) ** 2;
    sms += (market[i]! - mm) * (signal[i]! - ms);
  }
  if (smm === 0) return null;
  const b = sms / smm;
  // The signal's remainder after the market, which has mean zero and is uncorrelated with the market.
  const rest = signal.map((s, i) => s - ms - b * (market[i]! - mm));
  const srr = rest.reduce((a, r) => a + r * r, 0);
  if (srr <= 1e-18) return null;
  const my = avg(stock);
  let sym = 0;
  let syr = 0;
  for (let i = 0; i < n; i++) {
    sym += (stock[i]! - my) * (market[i]! - mm);
    syr += (stock[i]! - my) * rest[i]!;
  }
  const bm = sym / smm;
  const beta = syr / srr;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const e = stock[i]! - my - bm * (market[i]! - mm) - beta * rest[i]!;
    sse += e * e;
  }
  const se = Math.sqrt(sse / (n - 3) / srr);
  return { beta, t: se > 0 ? beta / se : beta === 0 ? 0 : Math.sign(beta) * Infinity, n };
}
