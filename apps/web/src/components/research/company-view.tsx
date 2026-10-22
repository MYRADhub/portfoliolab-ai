"use client";

import Link from "next/link";
import { useState } from "react";
import { NewsCard } from "@/components/news/news-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaSeries } from "@/components/charts/area-series";
import { compactUsd, pct, signedPct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { CompanyResearch, WhatIfOutcome } from "@/server/research";
import { Loading } from "@/components/ui/skeleton";

const tone = (x: number | null) =>
  x === null ? "text-muted-foreground" : x > 0 ? "text-gain" : x < 0 ? "text-loss" : "";

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${className ?? ""}`}>{value}</div>
    </div>
  );
}

export function CompanyView({ ticker }: { ticker: string }) {
  const { data, error } = useApi<CompanyResearch>(`/api/research/${encodeURIComponent(ticker)}`);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <Loading />;
  const { company, stats } = data;
  const na = (v: number | null, f: (x: number) => string) => (v === null ? "n/a" : f(v));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {company.ticker} <span className="font-normal text-muted-foreground">{company.name}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          {company.sector ?? "Unclassified"}
          {company.industry ? ` | ${company.industry}` : ""}
        </p>
      </div>

      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6"
        aria-label="Key statistics"
        role="group"
      >
        <Stat label="Last close" value={na(stats.last, (x) => x.toFixed(2))} />
        <Stat
          label="1 day"
          value={na(stats.d1, (x) => signedPct(x, 2))}
          className={tone(stats.d1)}
        />
        <Stat label="1 month" value={na(stats.m1, signedPct)} className={tone(stats.m1)} />
        <Stat label="3 months" value={na(stats.m3, signedPct)} className={tone(stats.m3)} />
        <Stat label="1 year" value={na(stats.y1, signedPct)} className={tone(stats.y1)} />
        <Stat label="Volatility" value={na(stats.volatility, (x) => pct(x))} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Price, last year</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {data.prices.length < 2 ? (
            <p className="text-sm text-muted-foreground">Not enough price history to chart.</p>
          ) : (
            <AreaSeries data={data.prices} xKey="date" yKey="close" />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hidden exposures</CardTitle>
          </CardHeader>
          <CardContent>
            {data.exposures.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No exposure profile has been loaded for this company.
              </p>
            ) : (
              <ul className="space-y-2 text-sm" aria-label="Exposures">
                {data.exposures.map((e) => (
                  <li
                    key={e.slug}
                    title={e.rationale ?? undefined}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{e.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {e.signed > 0 ? "+" : ""}
                      {e.signed} of 3 | confidence {pct(e.confidence, 0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {data.peers[0]?.basis === "sector"
                ? "Same-sector companies"
                : "Companies with similar exposures"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.peers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No comparable companies found.</p>
            ) : (
              <ul className="space-y-2 text-sm" aria-label="Peers">
                {data.peers.map((p) => (
                  <li key={p.ticker} className="flex items-baseline justify-between gap-3">
                    <Link href={`/research/${p.ticker}`} className="hover:underline">
                      <span className="font-medium">{p.ticker}</span> {p.name}
                    </Link>
                    <span className="tabular-nums text-muted-foreground">
                      {p.similarity === null
                        ? (p.sector ?? "")
                        : `${p.similarity.toFixed(2)} similar`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Fundamentals data={data.fundamentals} price={stats.last} />

      <WhatIf ticker={company.ticker} />

      <section aria-label="Recent news" className="space-y-3">
        <h2 className="text-lg font-semibold">Recent news</h2>
        {data.news.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent linked news.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.news.map((n) => (
              <NewsCard key={n.url} item={n} compact />
            ))}
          </div>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Statistics are computed from historical prices and fundamentals from SEC annual filings.
        They do not predict future results.
      </p>
    </div>
  );
}

function Fundamentals({
  data,
  price,
}: {
  data: CompanyResearch["fundamentals"];
  price: number | null;
}) {
  const r = data.ratios;
  const money = (v: number | null) => (v === null ? "n/a" : compactUsd(v));
  const rows: {
    label: string;
    get: (y: CompanyResearch["fundamentals"]["years"][number]) => string;
  }[] = [
    { label: "Revenue", get: (y) => money(y.revenue) },
    { label: "Operating income", get: (y) => money(y.operatingIncome) },
    { label: "Net income", get: (y) => money(y.netIncome) },
    { label: "Diluted EPS", get: (y) => (y.epsDiluted === null ? "n/a" : y.epsDiluted.toFixed(2)) },
    { label: "Operating cash flow", get: (y) => money(y.operatingCashFlow) },
    { label: "Total assets", get: (y) => money(y.totalAssets) },
    { label: "Equity", get: (y) => money(y.equity) },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fundamentals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {data.years.length === 0 ? (
          <p className="text-muted-foreground">
            No SEC annual figures are loaded for this company.
          </p>
        ) : (
          <>
            {r && (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Fundamental ratios">
                {[
                  ["Revenue growth", r.revenueGrowth === null ? "n/a" : signedPct(r.revenueGrowth)],
                  ["Net margin", r.netMargin === null ? "n/a" : pct(r.netMargin)],
                  ["Operating margin", r.operatingMargin === null ? "n/a" : pct(r.operatingMargin)],
                  ["Return on equity", r.returnOnEquity === null ? "n/a" : pct(r.returnOnEquity)],
                  [
                    "Price to earnings",
                    r.priceToEarnings === null ? "n/a" : r.priceToEarnings.toFixed(1),
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="overflow-x-auto">
              <table aria-label="Annual figures" className="w-full">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="py-1 pr-3 font-normal">
                      Fiscal year ending
                    </th>
                    {data.years.map((y) => (
                      <th
                        key={y.fiscalYear}
                        scope="col"
                        className="px-2 py-1 text-right font-normal"
                      >
                        {data.periodEnd[y.fiscalYear]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label} className="border-t">
                      <th scope="row" className="py-1 pr-3 text-left font-normal">
                        {row.label}
                      </th>
                      {data.years.map((y) => (
                        <td key={y.fiscalYear} className="px-2 py-1 text-right tabular-nums">
                          {row.get(y)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Source: SEC annual reports (10-K). Price to earnings uses the last close
              {price === null ? "" : ` of ${price.toFixed(2)}`} and the latest annual diluted EPS.
              Return on equity uses year-end equity.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const SIZES = [0.03, 0.05, 0.1];

function WhatIf({ ticker }: { ticker: string }) {
  const { data: list } = useApi<{ portfolios: { id: string; name: string }[] }>("/api/portfolios");
  const [picked, setPicked] = useState<string | null>(null);
  const [weight, setWeight] = useState(0.05);
  const portfolioId = picked ?? list?.portfolios[0]?.id ?? null;
  const { data, error } = useApi<WhatIfOutcome>(
    portfolioId
      ? `/api/portfolios/${portfolioId}/whatif?ticker=${ticker}&weight=${weight}`
      : "/api/health",
  );

  if (!list || list.portfolios.length === 0)
    return (
      <Card>
        <CardHeader>
          <CardTitle>What if you add it?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Create a portfolio to see how adding {ticker} would change your hidden concentration.
        </CardContent>
      </Card>
    );

  const out = data && "available" in data ? data : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>What if you add it?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {list.portfolios.length > 1 && (
            <select
              aria-label="Portfolio for what-if"
              className="rounded-md border bg-background px-2 py-1"
              value={portfolioId ?? ""}
              onChange={(e) => setPicked(e.target.value)}
            >
              {list.portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <div role="group" aria-label="Position size" className="flex items-center gap-2">
            <span>Add {ticker} at</span>
            {SIZES.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={weight === w}
                onClick={() => setWeight(w)}
                className={`rounded-md border px-3 py-1 ${weight === w ? "bg-muted font-medium" : ""}`}
              >
                {pct(w, 0)}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {out && !out.available && (
          <p>
            {out.reason === "already_held"
              ? `${ticker} is already in this portfolio.`
              : out.reason === "candidate_unprofiled"
                ? `${ticker} has no exposure profile yet, so the effect cannot be computed.`
                : "This portfolio needs exposure profiles for every holding first."}
          </p>
        )}
        {out && out.available && (
          <div aria-label="What-if result" role="region" className="space-y-1">
            <p>
              Effective hidden forces:{" "}
              <strong className="tabular-nums">
                {out.score.before.effectiveFactors?.toFixed(2) ?? "n/a"} to{" "}
                {out.score.after.effectiveFactors?.toFixed(2) ?? "n/a"}
              </strong>
              . Effective sectors:{" "}
              <strong className="tabular-nums">
                {out.score.before.effectiveSectors.toFixed(2)} to{" "}
                {out.score.after.effectiveSectors.toFixed(2)}
              </strong>
              .
            </p>
            {out.score.offsets.length > 0 && (
              <p>
                Leans against: {out.score.offsets.map((s) => out.factorNames[s] ?? s).join(", ")}.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Exposure arithmetic only. It says nothing about expected return and is not advice.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
