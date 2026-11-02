"use client";

import { Bot, Link2, Newspaper, Ruler, Scale, TrendingUp } from "lucide-react";
import { Loading } from "@/components/ui/skeleton";
import { pct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import type { NewsAnalysis } from "@/server/news-analysis";
import { ClassBadge } from "./class-badge";

const signed = (x: number | null, d = 1) =>
  x === null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const tone = (x: number | null) =>
  x === null ? "text-muted-foreground" : x > 0 ? "text-gain" : x < 0 ? "text-loss" : "";

const METHOD_LABEL: Record<string, string> = {
  provider_tag: "Tagged by the news feed",
  alias: "Name found in the story",
  llm: "Judged by AI",
  exposure: "Exposure link",
  web_search: "Found by searching for it",
};

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Bot;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
      </h4>
      {children}
    </section>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="tabular-nums">{value} of 10</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted" aria-hidden="true">
        <div className="h-1.5 rounded-full bg-foreground/70" style={{ width: `${value * 10}%` }} />
      </div>
    </div>
  );
}

/** Everything behind one story's ranking: who covered it, the links, the classification, the arithmetic, the reaction. */
export function NewsAnalysisPanel({
  portfolioId,
  articleId,
}: {
  portfolioId: string;
  articleId: number;
}) {
  const { data, error } = useApi<NewsAnalysis>(`/api/portfolios/${portfolioId}/news/${articleId}`);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <Loading rows={2} />;
  const latest = data.classifications[0] ?? null;
  return (
    <div
      className="space-y-5 rounded-xl border bg-muted/30 p-4 text-sm"
      aria-label="How we judged this story"
      role="region"
    >
      <Section
        icon={Newspaper}
        title={`Coverage: ${data.coverage.length} ${data.coverage.length === 1 ? "article" : "articles"} from ${data.outlets} ${data.outlets === 1 ? "outlet" : "outlets"}`}
      >
        <ol className="space-y-1">
          {data.coverage.map((c, i) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {c.publishedAt.slice(0, 16).replace("T", " ")} UTC
              </span>
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline-offset-2 hover:underline"
              >
                {c.source ?? c.provider}
              </a>
              <span className="text-xs text-muted-foreground">
                via{" "}
                {c.provider === "web"
                  ? "web search"
                  : c.provider === "sec"
                    ? "SEC EDGAR"
                    : c.provider}
                {i === 0 ? ", first to report" : ""}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">
          Articles with nearly the same headline within two days are grouped as one story, so
          syndicated copies are counted once.
        </p>
      </Section>

      <Section icon={Link2} title="Which holdings it is about">
        {data.links.length === 0 ? (
          <p className="text-muted-foreground">Not linked to any company.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.links.map((l) => (
              <li key={`${l.ticker}-${l.method}`} className={cn(l.ignored && "opacity-80")}>
                <span className="font-semibold">{l.ticker}</span>{" "}
                <span className="text-muted-foreground">
                  {METHOD_LABEL[l.method] ?? l.method}, {pct(l.score, 0)} confident
                  {l.weight !== null ? `, ${pct(l.weight, 1)} of your portfolio` : ", not held"}
                  {l.ignored ? ", too weak to count" : ""}
                </span>
                <div className="text-xs text-muted-foreground">
                  {l.why}
                  {l.evidence.length > 0 && (
                    <> Found: {l.evidence.map((e) => `"${e}"`).join(", ")}.</>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={Bot} title="What kind of news it is">
        {!latest ? (
          <p className="text-muted-foreground">
            Not classified yet; it is ranked with a neutral impact.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ClassBadge value={latest.class} />
              {latest.eventType && (
                <span className="rounded-md border px-1.5 py-0.5 text-xs">
                  {latest.eventType.name}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {latest.decidedBy === "rules"
                  ? `Decided by fixed rules (${latest.model}, ${latest.promptVersion})`
                  : `Decided by AI (${latest.model}, prompt ${latest.promptVersion}), ${pct(latest.confidence, 0)} confident`}
                , on {latest.createdAt.slice(0, 10)}
              </span>
            </div>
            {latest.eventType && (
              <p className="text-xs text-muted-foreground">{latest.eventType.definition}</p>
            )}
            <p>
              <span className="font-medium">Why it matters: </span>
              {latest.mechanism}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Score label="Importance to the business" value={latest.fundamentalImportance} />
              <Score label="Likely market attention" value={latest.marketRelevance} />
              <Score label="How long it lasts" value={latest.expectedPersistence} />
            </div>
            {data.classifications.length > 1 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  Earlier classifications ({data.classifications.length - 1})
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {data.classifications.slice(1).map((c) => (
                    <li key={c.createdAt}>
                      {c.class}, importance {c.fundamentalImportance}, by {c.model} (
                      {c.promptVersion}) on {c.createdAt.slice(0, 10)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Section>

      <Section icon={Ruler} title={`Relevance to you: ${data.relevance.score.toFixed(1)} of 10`}>
        <table className="w-full text-xs">
          <tbody>
            {data.relevance.steps.map((s) => (
              <tr key={s.label} className="border-b last:border-0 align-top">
                <td className="py-1 pr-2 font-medium whitespace-nowrap">{s.label}</td>
                <td className="py-1 pr-2 tabular-nums whitespace-nowrap">{s.value}</td>
                <td className="py-1 text-muted-foreground">{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          {data.relevance.shown
            ? "Shown as relevant."
            : `Below ${data.relevance.threshold} of 10, so it is collapsed with the low-relevance stories.`}{" "}
          Impact caps: fundamental {data.relevance.rules.classCaps.fundamental}, narrative{" "}
          {data.relevance.rules.classCaps.narrative}, unclear{" "}
          {data.relevance.rules.classCaps.unclear}, noise {data.relevance.rules.classCaps.noise}, so
          gossip cannot outrank a real change in the business.
        </p>
      </Section>

      <Section icon={TrendingUp} title="How the market reacted">
        {data.reactions.length === 0 ? (
          <p className="text-muted-foreground">
            No holding of yours is linked, so there is no reaction to show.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Holding</th>
                <th className="py-1 pr-2 font-medium">First trading day</th>
                <th className="py-1 pr-2 text-right font-medium">Stock</th>
                <th className="py-1 pr-2 text-right font-medium">S&amp;P 500</th>
                <th className="py-1 pr-2 text-right font-medium">Difference</th>
                <th className="py-1 text-right font-medium">Two days, difference</th>
              </tr>
            </thead>
            <tbody>
              {data.reactions.map((r) => (
                <tr key={r.ticker} className="border-t">
                  <td className="py-1 pr-2 font-medium">{r.ticker}</td>
                  <td className="py-1 pr-2 tabular-nums">{r.tradingDate}</td>
                  <td className={cn("py-1 pr-2 text-right tabular-nums", tone(r.stockDay))}>
                    {signed(r.stockDay)}
                  </td>
                  <td className={cn("py-1 pr-2 text-right tabular-nums", tone(r.marketDay))}>
                    {signed(r.marketDay)}
                  </td>
                  <td
                    className={cn(
                      "py-1 pr-2 text-right font-medium tabular-nums",
                      tone(r.excessDay),
                    )}
                  >
                    {signed(r.excessDay)}
                  </td>
                  <td className={cn("py-1 text-right tabular-nums", tone(r.excessTwoDay))}>
                    {signed(r.excessTwoDay)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.reactions.some((r) => r.note) && (
          <p className="text-xs text-muted-foreground">
            {data.reactions.find((r) => r.note)!.note}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          The first trading day is the one whose price could reflect the story (the same day if it
          came out before the close). A move is not proof the story caused it.
        </p>
      </Section>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Scale className="size-3.5" aria-hidden="true" /> Research, not advice.
      </p>
    </div>
  );
}
