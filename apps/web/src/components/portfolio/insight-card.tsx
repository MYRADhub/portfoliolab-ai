import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Insight, Severity } from "@/server/insights";

const SEVERITY: Record<Severity, { label: string; icon: string; badge: string; edge: string }> = {
  alert: { label: "Alert", icon: "▲", badge: "bg-loss-soft text-loss", edge: "border-l-loss" },
  watch: { label: "Watch", icon: "●", badge: "bg-warn-soft text-warn", edge: "border-l-warn" },
  info: { label: "Info", icon: "○", badge: "bg-info-soft text-info", edge: "border-l-info" },
};

/** One plain-language finding. The severity is shown as a word and a shape as well as a color. */
export function InsightCard({ insight }: { insight: Insight }) {
  const s = SEVERITY[insight.severity];
  return (
    <article
      className={cn(
        "flex h-full flex-col gap-2 rounded-xl border border-l-4 bg-card p-4 text-card-foreground shadow-xs",
        s.edge,
      )}
    >
      <span
        className={cn(
          "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
          s.badge,
        )}
      >
        <span aria-hidden="true">{s.icon}</span>
        {s.label}
      </span>
      <h3 className="leading-snug font-semibold">{insight.title}</h3>
      <p className="flex-1 text-sm text-muted-foreground">{insight.detail}</p>
      <Link href={insight.href} className="w-fit text-sm font-medium underline underline-offset-2">
        {insight.linkLabel}
      </Link>
    </article>
  );
}
