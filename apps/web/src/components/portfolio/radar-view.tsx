"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { CLASS_STYLE, type NewsClassKey } from "@/components/news/class-badge";
import { NewsCard } from "@/components/news/news-card";
import { cn } from "@/lib/utils";
import { useApi } from "@/lib/use-api";
import type { Radar, RadarItem } from "@/server/radar";
import { WithPortfolio } from "./with-portfolio";
import { HowToRead } from "@/components/ui/how-to-read";
import { Loading } from "@/components/ui/skeleton";

const DAYS = [1, 3, 7, 14, 30];
const TYPES: NewsClassKey[] = ["fundamental", "narrative", "noise", "unclear", "unclassified"];

export function RadarView() {
  return <WithPortfolio>{(id) => <Content id={id} />}</WithPortfolio>;
}

const keyOf = (i: RadarItem): NewsClassKey =>
  i.classification ? ((i.classification.class as NewsClassKey) ?? "unclassified") : "unclassified";

function Content({ id }: { id: string }) {
  const [days, setDays] = useState(7);
  const [type, setType] = useState<NewsClassKey | "">("");
  const [ticker, setTicker] = useState("");
  const query = new URLSearchParams({ days: String(days), ...(ticker ? { ticker } : {}) });
  const [version, setVersion] = useState(0);
  const { data, error } = useApi<Radar>(`/api/portfolios/${id}/radar?${query}&v=${version}`);
  const filtered = type !== "" || ticker !== "";

  return (
    <div className="space-y-4">
      <HowToRead>
        <p>
          Each story gets a score from 0 to 10 for how much it matters to <em>your</em> portfolio.
          The score multiplies three things: how much of your money the story touches, how
          economically important the news is (real change counts for more than chatter), and how
          fresh it is.
        </p>
        <p>
          Open the breakdown on any card to see the three parts. Low-scoring stories are collapsed,
          not hidden.
        </p>
      </HowToRead>
      <ScanBar portfolioId={id} onDone={() => setVersion((v) => v + 1)} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Period
          <select
            aria-label="Period"
            className="rounded-md border bg-background px-2 py-1"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                Last {d} {d === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Holding
          <select
            aria-label="Holding"
            className="rounded-md border bg-background px-2 py-1"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
          >
            <option value="">All holdings</option>
            {(data?.holdings ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            type="button"
            className="underline"
            onClick={() => {
              setType("");
              setTicker("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!data && !error && <Loading />}
      {data && (
        <Results data={data} type={type} setType={setType} filtered={filtered} portfolioId={id} />
      )}
    </div>
  );
}

function Results({
  data,
  type,
  setType,
  filtered,
  portfolioId,
}: {
  data: Radar;
  type: NewsClassKey | "";
  setType: (t: NewsClassKey | "") => void;
  filtered: boolean;
  portfolioId: string;
}) {
  const byType = type === "" ? data.items : data.items.filter((i) => keyOf(i) === type);
  const shown = byType.filter((i) => i.relevance.score >= data.threshold);
  const collapsed = byType.filter((i) => i.relevance.score < data.threshold);

  if (data.counts.total === 0) {
    return (
      <p className="text-muted-foreground">
        {filtered
          ? "No items match these filters."
          : `No news matched your holdings in the last ${data.days} ${data.days === 1 ? "day" : "days"}. News appears here once it has been collected for companies you hold.`}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <Overview data={data} />
      <div role="group" aria-label="Type" className="flex flex-wrap gap-2">
        <TypeChip
          active={type === ""}
          onClick={() => setType("")}
          icon=""
          label="All types"
          count={data.counts.total}
        />
        {TYPES.map((t) => (
          <TypeChip
            key={t}
            active={type === t}
            onClick={() => setType(t)}
            icon={CLASS_STYLE[t].icon}
            label={CLASS_STYLE[t].label}
            count={data.counts.byClass[t] ?? 0}
            tone={CLASS_STYLE[t].tone}
            title={CLASS_STYLE[t].meaning}
          />
        ))}
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {byType.length} {byType.length === 1 ? "story" : "stories"}: {shown.length} relevant,{" "}
        {collapsed.length} collapsed as low relevance. Each card shows a 0 to 10 relevance score for
        this portfolio.
      </p>

      {byType.length === 0 && (
        <p className="text-muted-foreground">No items match these filters.</p>
      )}

      {shown.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label="Ranked news">
          {shown.map((item, idx) => (
            <li key={item.url} className={cn(idx === 0 && "lg:col-span-2")}>
              {idx === 0 && (
                <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Most relevant right now
                </p>
              )}
              <NewsCard item={item} portfolioId={portfolioId} />
            </li>
          ))}
        </ul>
      )}

      {collapsed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {collapsed.length} low-relevance {collapsed.length === 1 ? "item" : "items"}
          </summary>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2" aria-label="Low-relevance news">
            {collapsed.map((item) => (
              <li key={item.url}>
                <NewsCard item={item} portfolioId={portfolioId} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TypeChip({
  active,
  onClick,
  icon,
  label,
  count,
  tone,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  count: number;
  tone?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
        active ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
        !active && tone,
      )}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-xs tabular-nums",
          active ? "bg-background/20" : "bg-background/60",
        )}
      >
        {count}
      </span>
    </button>
  );
}

/** Where the news comes from and whom it is about, across every story found in the period. */
function Overview({ data }: { data: Radar }) {
  const o = data.overview;
  const max = Math.max(1, ...o.byHolding.map((h) => h.count));
  return (
    <section aria-label="News overview" className="grid gap-3 md:grid-cols-3">
      <div className="rounded-2xl border bg-card p-4">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Stories per holding</h3>
        {o.byHolding.length === 0 ? (
          <p className="text-sm text-muted-foreground">None linked.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {o.byHolding.slice(0, 6).map((h) => (
              <li key={h.key} className="grid grid-cols-[3.5rem_1fr_2rem] items-center gap-2">
                <span className="font-medium">{h.key}</span>
                <span className="h-1.5 rounded-full bg-muted" aria-hidden="true">
                  <span
                    className="block h-1.5 rounded-full bg-primary/70"
                    style={{ width: `${(h.count / max) * 100}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">{h.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-2xl border bg-card p-4">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Sources</h3>
        <ul className="space-y-1 text-sm">
          {o.byOutlet.slice(0, 6).map((x) => (
            <li key={x.key} className="flex justify-between gap-2">
              <span className="truncate">{x.key}</span>
              <span className="tabular-nums text-muted-foreground">{x.count}</span>
            </li>
          ))}
        </ul>
        {o.byOutlet.length > 6 && (
          <p className="mt-1 text-xs text-muted-foreground">and {o.byOutlet.length - 6} more</p>
        )}
      </div>
      <div className="rounded-2xl border bg-card p-4">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">What kind of news</h3>
        <ul className="space-y-1 text-sm">
          {o.byClass.map((x) => (
            <li key={x.key} className="flex justify-between gap-2">
              <span>{CLASS_STYLE[(x.key as NewsClassKey) ?? "unclassified"]?.label ?? x.key}</span>
              <span className="tabular-nums text-muted-foreground">{x.count}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Fundamental news changes a company&rsquo;s economics; narrative news moves sentiment;
          noise does neither.
        </p>
      </div>
    </section>
  );
}

interface ScanResult {
  range: { from: string; to: string };
  providers: string[];
  fetched: number;
  inserted: number;
  duplicates: number;
  linked: number;
  searchLinked: number;
  classified: number;
  failures: { provider: string; ticker: string; error: string }[];
}

/** Looks for fresh news about every holding, then reloads the ranking. */
function ScanBar({ portfolioId, onDone }: { portfolioId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function scan() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<ScanResult>(`/api/portfolios/${portfolioId}/news/scan`, {
        method: "POST",
      });
      setResult(r);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The scan failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Find the latest news</p>
        <p className="text-xs text-muted-foreground">
          Searches the web (and the news feed, when one is set up) for the last week&rsquo;s news on
          each holding, then links, groups and classifies what it finds.
        </p>
      </div>
      <Button onClick={() => void scan()} disabled={busy} size="sm">
        <RefreshCw className={cn(busy && "animate-spin")} />{" "}
        {busy ? "Scanning, this takes a moment" : "Scan now"}
      </Button>
      {result && (
        <p className="w-full text-xs text-muted-foreground" aria-live="polite" role="status">
          Searched {result.providers.map((p) => (p === "web" ? "the web" : p)).join(" and ")} for{" "}
          {result.range.from} to {result.range.to}: {result.fetched} dated articles,{" "}
          {result.inserted} new, {result.duplicates} already known, {result.linked} linked to
          companies
          {result.searchLinked
            ? ` (${result.searchLinked} only by the search that found them)`
            : ""}
          , {result.classified} classified
          {result.failures.length ? `, ${result.failures.length} problems` : ""}.
        </p>
      )}
      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
