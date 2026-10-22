import { ClassBadge, toClassKey } from "@/components/news/class-badge";
import { ImportanceMeter } from "@/components/news/importance-meter";
import { RelevanceRing } from "@/components/news/relevance-ring";
import { formatAge, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface NewsCardItem {
  title: string;
  url: string;
  source: string | null;
  ageDays: number;
  copies: number;
  relevance: {
    score: number;
    exposureMatch: number;
    impact: number;
    recency: number;
    matched: { ticker: string; linkScore: number; weight: number; contribution: number }[];
  };
  classification: { class: string; fundamentalImportance: number; mechanism: string } | null;
}

const METER_TONE: Record<string, string> = {
  fundamental: "bg-info",
  narrative: "bg-warn",
  noise: "bg-muted-foreground/60",
  unclear: "bg-muted-foreground/60",
  unclassified: "bg-muted-foreground/60",
};

function Part({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <li className="space-y-0.5">
      <div className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="tabular-nums">{pct(value, 0)}</span>
      </div>
      <div className="h-1.5 rounded bg-muted" aria-hidden="true">
        <div
          className="h-1.5 rounded bg-foreground/70"
          style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground">{note}</div>
    </li>
  );
}

/**
 * One story, shown as a card: relevance ring, type badge, importance meter, the holdings it touches, and a
 * "why am I seeing this?" breakdown. `compact` hides the importance meter and breakdown for use in small panels.
 */
export function NewsCard({ item, compact = false }: { item: NewsCardItem; compact?: boolean }) {
  const r = item.relevance;
  const c = item.classification;
  const key = toClassKey(c?.class);
  return (
    <article
      className={cn(
        "flex gap-3 rounded-xl border bg-card p-3 text-card-foreground shadow-xs",
        compact ? "text-sm" : "",
      )}
    >
      <RelevanceRing score={r.score} size={compact ? 48 : 56} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ClassBadge value={c?.class} />
          <span className="text-xs text-muted-foreground">
            {item.source ? `${item.source} | ` : ""}
            {formatAge(item.ageDays)}
            {item.copies > 0 ? ` | ${item.copies} similar` : ""}
          </span>
        </div>
        <h3 className="leading-snug font-medium">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {item.title}
          </a>
        </h3>
        {c && !compact && (
          <p className="text-sm text-muted-foreground">What it means: {c.mechanism}</p>
        )}
        {c && !compact && (
          <ImportanceMeter value={c.fundamentalImportance} tone={METER_TONE[key]} />
        )}
        <ul className="flex flex-wrap gap-1.5" aria-label="Holdings touched">
          {r.matched.map((m) => (
            <li
              key={m.ticker}
              className="rounded-md border px-1.5 py-0.5 text-xs"
              title={`${pct(m.linkScore, 0)} sure the story is about ${m.ticker}; ${pct(m.weight, 0)} of your portfolio`}
            >
              <span className="font-semibold">{m.ticker}</span>{" "}
              <span className="text-muted-foreground">{pct(m.weight, 0)} of portfolio</span>
            </li>
          ))}
        </ul>
        {!compact && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Why am I seeing this?
            </summary>
            <ul className="mt-2 space-y-2">
              <Part
                label="Holdings touched"
                value={r.exposureMatch}
                note={r.matched
                  .map(
                    (m) =>
                      `${m.ticker}: ${pct(m.linkScore, 0)} sure it is about them, ${pct(m.weight, 0)} of your portfolio`,
                  )
                  .join("; ")}
              />
              <Part
                label="Economic impact"
                value={r.impact}
                note={c ? c.mechanism : "Not yet classified, so a neutral 50%"}
              />
              <Part
                label="Freshness"
                value={r.recency}
                note="Half the relevance is lost every 3 days"
              />
              <li className="text-xs text-muted-foreground">
                Score = 10 x holdings touched x impact x freshness = {r.score.toFixed(1)}
              </li>
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}
