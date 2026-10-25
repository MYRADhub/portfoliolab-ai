"use client";

import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { pct, signedPct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { BenchmarkResult } from "@/server/benchmark";
import type { PortfolioExposures } from "@/server/exposures";
import type { Insight } from "@/server/insights";
import type { StressOutcome } from "@/server/stress";
import type { Terminal } from "@/server/terminal";
import { AreaSeries } from "@/components/charts/area-series";
import { WithPortfolio } from "./with-portfolio";

const PRESETS = ["rate-shock", "ai-pullback", "recession"];

export function ReportView() {
  return <WithPortfolio>{(id) => <Report key={id} id={id} />}</WithPortfolio>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-2">
      <h2 className="border-b pb-1 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Report({ id }: { id: string }) {
  const { data: t, error } = useApi<Terminal>(`/api/portfolios/${id}/terminal`);
  const { data: x } = useApi<PortfolioExposures>(`/api/portfolios/${id}/exposures`);
  const { data: ins } = useApi<{ insights: Insight[] }>(`/api/portfolios/${id}/insights`);
  const { data: bench } = useApi<BenchmarkResult>(`/api/portfolios/${id}/benchmark`);
  const [stress, setStress] = useState<
    (Extract<StressOutcome, { available: true }> & { id: string })[] | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      PRESETS.map((p) =>
        api<StressOutcome>(`/api/portfolios/${id}/stress`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ preset: p }),
        }).then((r) => (r.available ? { ...r, id: p } : null)),
      ),
    )
      .then(
        (rs) => !cancelled && setStress(rs.filter((r): r is NonNullable<typeof r> => r !== null)),
      )
      .catch(() => !cancelled && setStress([]));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!t || !x || !ins || !bench || !stress) return <Loading rows={2} />;

  const generated = new Date().toISOString().slice(0, 10);
  const perf = (label: string) => t.performance.find((p) => p.label === label)?.value ?? null;

  return (
    <article
      aria-label="Portfolio report"
      className="mx-auto max-w-4xl space-y-6 text-sm print:max-w-none print:space-y-4 print:text-[11px]"
    >
      <header className="space-y-1">
        <p className="text-xs text-muted-foreground">
          PortfolioLab report | prepared {generated} | data as of {t.asOf}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight" data-testid="report-title">
          {t.portfolio.name}
        </h2>
        <p className="text-muted-foreground">
          {t.holdings.length} holdings over {t.window.tradingDays} trading days ({t.window.from} to{" "}
          {t.window.to}), constant target weights rebalanced daily.
        </p>
      </header>

      <Section title="Key figures">
        <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            ["Portfolio index", t.index.value.toFixed(1)],
            ["1 month", perf("1 month") === null ? "n/a" : signedPct(perf("1 month")!)],
            [
              "Year to date",
              perf("Year to date") === null ? "n/a" : signedPct(perf("Year to date")!),
            ],
            ["Volatility", pct(t.risk.volatility, 1)],
            ["Worst fall", pct(t.risk.maxDrawdown, 1)],
            ["Sharpe", t.risk.sharpe.toFixed(2)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-lg font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="h-44 print:h-36">
          <AreaSeries data={t.equity} xKey="date" yKey="value" />
        </div>
      </Section>

      <Section title="What to know">
        {ins.insights.length === 0 ? (
          <p className="text-muted-foreground">Nothing stands out right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {ins.insights.slice(0, 5).map((i) => (
              <li key={i.id}>
                <span className="font-medium">{i.title}.</span>{" "}
                <span className="text-muted-foreground">{i.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Holdings">
        <table className="w-full" aria-label="Report holdings">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 font-normal">
                Holding
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Weight
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Share of risk
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                1 month
              </th>
            </tr>
          </thead>
          <tbody>
            {t.holdings.map((h) => (
              <tr key={h.ticker} className="border-t">
                <td className="py-1">
                  <span className="font-medium">{h.ticker}</span>{" "}
                  <span className="text-muted-foreground">{h.sector}</span>
                </td>
                <td className="py-1 text-right tabular-nums">{pct(h.weight, 1)}</td>
                <td className="py-1 text-right tabular-nums">{pct(h.riskShare, 1)}</td>
                <td className="py-1 text-right tabular-nums">
                  {h.m1 === null ? "n/a" : signedPct(h.m1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Hidden concentration">
        {!x.available ? (
          <p className="text-muted-foreground">
            Exposure data is not available for every holding, so concentration by economic force
            cannot be shown.
          </p>
        ) : (
          <>
            <p>
              By sector the portfolio looks like{" "}
              <strong>{x.concentration.effectiveSectors.toFixed(1)}</strong> groups; by economic
              force like <strong>{x.concentration.effectiveFactors?.toFixed(1) ?? "n/a"}</strong>.
              Largest forces:{" "}
              {x.factors
                .slice(0, 3)
                .map((f) => `${f.name} (${pct(f.share, 0)})`)
                .join(", ")}
              .
            </p>
            {x.cells.some(
              (c) => c.rationale?.startsWith("AI-drafted") || c.rationale?.startsWith("Demo data"),
            ) && (
              <p className="text-xs text-muted-foreground">
                Some exposure scores are unreviewed AI drafts or illustrative placeholders.
              </p>
            )}
          </>
        )}
      </Section>

      <Section title="Against the market">
        {!bench.available ? (
          <p className="text-muted-foreground">No benchmark comparison is available.</p>
        ) : (
          <p>
            Beta {bench.stats.beta?.toFixed(2) ?? "n/a"}, correlation{" "}
            {bench.stats.correlation?.toFixed(2) ?? "n/a"}, tracking error{" "}
            {bench.stats.trackingError === null ? "n/a" : pct(bench.stats.trackingError, 1)}. It
            captured {bench.stats.upCapture === null ? "n/a" : pct(bench.stats.upCapture, 0)} of the{" "}
            {bench.benchmark.name} up days and{" "}
            {bench.stats.downCapture === null ? "n/a" : pct(bench.stats.downCapture, 0)} of its down
            days.
          </p>
        )}
      </Section>

      <Section title="Stress scenarios (illustrative)">
        {stress.length === 0 ? (
          <p className="text-muted-foreground">
            Stress tests need exposure data for every holding.
          </p>
        ) : (
          <ul className="space-y-1">
            {stress.map((s) => (
              <li key={s.id} className="flex justify-between gap-4">
                <span>
                  {s.id === "rate-shock"
                    ? "Interest rates jump"
                    : s.id === "ai-pullback"
                      ? "AI spending pullback"
                      : "Recession"}
                </span>
                <span className="tabular-nums">
                  {s.touched
                    ? `${signedPct(s.portfolioImpact, 2)} (vulnerability ${s.vulnerability.toFixed(1)} of 10)`
                    : "no exposure"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="border-t pt-3 text-xs text-muted-foreground">
        PortfolioLab provides research information, not investment advice. Figures are computed from
        historical data and do not predict future results. Exposure scores are judgments with stated
        confidence, not measurements.
      </footer>
    </article>
  );
}

/** Opens the browser's print dialog, where "Save as PDF" is one of the choices. */
export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden="true" />
      Print or save as PDF
    </Button>
  );
}
