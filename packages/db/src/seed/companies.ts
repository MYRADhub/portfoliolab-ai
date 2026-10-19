import type { Db } from "../client";
import { companies } from "../schema";

// Development fixtures only. The real S&P 500 universe is loaded in Phase 2.
export const devCompanies = [
  {
    ticker: "NVDA",
    name: "NVIDIA Corporation",
    sector: "Information Technology",
    industry: "Semiconductors",
  },
  {
    ticker: "AAPL",
    name: "Apple Inc.",
    sector: "Information Technology",
    industry: "Technology Hardware",
  },
  {
    ticker: "MSFT",
    name: "Microsoft Corporation",
    sector: "Information Technology",
    industry: "Software",
  },
  {
    ticker: "AMZN",
    name: "Amazon.com, Inc.",
    sector: "Consumer Discretionary",
    industry: "Broadline Retail",
  },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", sector: "Financials", industry: "Banks" },
];

export async function seedDevCompanies(db: Db): Promise<void> {
  await db.insert(companies).values(devCompanies).onConflictDoNothing({ target: companies.ticker });
}
