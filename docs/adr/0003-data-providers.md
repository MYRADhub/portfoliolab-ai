# ADR 0003: Data providers

Status: proposed, pending the provider spike (`scripts/provider-spike`)

## Constraints

- Free tiers only for now.
- Universe is the S&P 500.
- News needs publish timestamps (event-study alignment) and a license that permits display.

## Candidates

- Prices: Tiingo, Alpha Vantage, Finnhub (check adjusted close and split handling).
- News: Finnhub company news, Marketaux.
- Macro: FRED. Filings: SEC EDGAR (8-K as a free, timestamped event source).

## Decision

Not yet made. All providers sit behind `PriceProvider` and `NewsProvider` interfaces so the choice is reversible. Spike output and license review are attached below once run.

## Spike results

Pending API keys.
