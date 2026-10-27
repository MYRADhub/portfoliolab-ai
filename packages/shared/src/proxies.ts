/**
 * Market signals used to check the exposure scores against prices. Each force is matched to the daily return of a
 * traded fund, or the difference of two funds, that tends to rise when the force rises. `sign` -1 flips a fund that
 * falls when the force rises (bond prices fall when interest rates rise). A force with no clean signal has none.
 */
export interface ForceProxy {
  /** Fund whose return is the signal; with `minus`, the signal is this fund's return minus that one's. */
  symbol: string;
  minus?: string;
  sign: 1 | -1;
  /** Plain description of the signal, for the page. */
  label: string;
}

export const FORCE_PROXIES: Record<string, ForceProxy | null> = {
  oil_price: { symbol: "USO", sign: 1, label: "crude oil fund (USO)" },
  interest_rates: {
    symbol: "IEF",
    sign: -1,
    label: "7-10 year Treasury bond fund (IEF), flipped: bond prices fall when rates rise",
  },
  usd_strength: { symbol: "UUP", sign: 1, label: "U.S. dollar index fund (UUP)" },
  semiconductor_demand: { symbol: "SOXX", sign: 1, label: "semiconductor stock fund (SOXX)" },
  china_demand: { symbol: "FXI", sign: 1, label: "large Chinese companies fund (FXI)" },
  consumer_spending: {
    symbol: "XLY",
    minus: "XLP",
    sign: 1,
    label: "consumer discretionary minus consumer staples (XLY - XLP)",
  },
  inflation: {
    symbol: "TIP",
    minus: "IEF",
    sign: 1,
    label: "inflation-protected minus ordinary Treasury bonds (TIP - IEF)",
  },
  economic_growth: {
    symbol: "XLI",
    minus: "XLU",
    sign: 1,
    label: "industrials minus utilities (XLI - XLU)",
  },
  enterprise_it_spending: { symbol: "IGV", sign: 1, label: "software company fund (IGV)" },
  healthcare_spending: { symbol: "XLV", sign: 1, label: "health care stock fund (XLV)" },
  taiwan_supply_chain_risk: {
    symbol: "EWT",
    sign: -1,
    label: "Taiwan stock fund (EWT), flipped: Taiwan stocks fall when the risk rises",
  },
  ai_infrastructure_capex: null,
};

/** Every fund the price check needs, plus the market itself. */
export const PROXY_SYMBOLS: string[] = [
  "SPY",
  ...new Set(
    Object.values(FORCE_PROXIES).flatMap((p) =>
      p ? [p.symbol, ...(p.minus ? [p.minus] : [])] : [],
    ),
  ),
].sort();
