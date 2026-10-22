"use client";

import Link from "next/link";
import { NewsCard } from "@/components/news/news-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaSeries } from "@/components/charts/area-series";
import { pct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import type { Insight } from "@/server/insights";
import type { Radar } from "@/server/radar";
import type { Terminal } from "@/server/terminal";
import { GettingStarted } from "@/components/onboarding/getting-started";
import { ExplainPanel } from "./explain-panel";
import { InsightCard } from "./insight-card";
import { MovePanel } from "./move-panel";
import { WithPortfolio } from "./with-portfolio";
import { Loading } from "@/components/ui/skeleton";

const signed = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const tone = (x: number | null) =>
  x === null ? "text-muted-foreground" : x > 0 ? "text-gain" : x < 0 ? "text-loss" : "";

function Stat({
  label,
  value,
  sub,
  valueClass = "",
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3 text-card-foreground shadow-xs">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", valueClass)}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Dashboard() {
  return <WithPortfolio>{(id) => <PortfolioView id={id} />}</WithPortfolio>;
}

function PortfolioView({ id }: { id: string }) {
  const { data: t, error } = useApi<Terminal>(`/api/portfolios/${id}/terminal`);
  const { data: insights } = useApi<{ insights: Insight[] }>(`/api/portfolios/${id}/insights`);
  const { data: radar } = useApi<Radar>(`/api/portfolios/${id}/radar?days=7`);

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!t) return <Loading />;

  const perf = (label: string) => t.performance.find((p) => p.label === label)?.value ?? null;
  const ytd = perf("Year to date");
  const month = perf("1 month");

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {t.window.from} to {t.window.to} ({t.window.tradingDays} trading days). Constant target
        weights, rebalanced daily. Risk-free rate 0.0%. For every chart and table, open the{" "}
        <Link href="/terminal" className="underline">
          Terminal
        </Link>
        .
      </p>

      <GettingStarted />

      <section
        aria-label="Key figures"
        data-tour="kpis"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        <Stat
          label="Portfolio index"
          value={t.index.value.toFixed(1)}
          sub={`${signed(t.index.dayChange, 2)} today`}
          valueClass=""
        />
        <Stat
          label="1 month"
          value={month === null ? "n/a" : signed(month)}
          valueClass={tone(month)}
        />
        <Stat
          label={ytd === null ? "Whole window" : "Year to date"}
          value={signed(ytd ?? perf("Whole window") ?? 0)}
          valueClass={tone(ytd ?? perf("Whole window"))}
        />
        <Stat label="Volatility (ann.)" value={pct(t.risk.volatility)} />
        <Stat label="Max drawdown" value={signed(t.risk.maxDrawdown)} valueClass="text-loss" />
        <Stat label="Sharpe" value={t.risk.sharpe.toFixed(2)} />
      </section>

      <section aria-label="What to know now" data-tour="insights" className="space-y-3">
        <h2 className="text-lg font-semibold">What to know now</h2>
        {!insights ? (
          <Loading />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Insights">
            {insights.insights.slice(0, 6).map((i) => (
              <li key={i.id}>
                <InsightCard insight={i} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Portfolio index (100 at the start)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <AreaSeries data={t.equity} xKey="date" yKey="value" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your holdings</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5 text-sm" aria-label="Holdings snapshot">
              {t.holdings.map((h) => (
                <li key={h.ticker}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{h.ticker}</span>
                    <span className="tabular-nums text-muted-foreground">{pct(h.weight, 0)}</span>
                    <span className={cn("w-16 text-right tabular-nums", tone(h.d1))}>
                      {h.d1 === null ? "n/a" : signed(h.d1, 2)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-muted" aria-hidden="true">
                    <div
                      className="h-1.5 rounded bg-info"
                      style={{ width: `${Math.max(2, Math.min(100, h.weight * 100))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Weight, then today&rsquo;s move. Full detail on the Terminal&rsquo;s Overview.
            </p>
          </CardContent>
        </Card>
      </div>

      <MovePanel portfolioId={id} />

      <section aria-label="Top news" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Top news for this portfolio</h2>
          <Link href="/news" className="text-sm underline">
            All news
          </Link>
        </div>
        {!radar ? (
          <Loading />
        ) : radar.items.length === 0 ? (
          <p className="text-muted-foreground">No news matched your holdings in the last 7 days.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-3" aria-label="Top news">
            {radar.items.slice(0, 3).map((n) => (
              <li key={n.url}>
                <NewsCard item={n} compact />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ExplainPanel portfolioId={id} />
    </div>
  );
}
