import { cn } from "@/lib/utils";
import { relevanceBand, type RelevanceBand } from "@/lib/relevance-band";

const BAND_TONE: Record<RelevanceBand, string> = {
  high: "text-warn",
  medium: "text-info",
  low: "text-muted-foreground",
};

/** A ring that fills with the relevance score, with the number and a High/Medium/Low word inside and below. */
export function RelevanceRing({ score, size = 56 }: { score: number; size?: number }) {
  const { band, label } = relevanceBand(score);
  const r = 18;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(10, score)) / 10) * c;
  return (
    <div
      className="flex shrink-0 flex-col items-center gap-0.5"
      aria-label={`Relevance ${score.toFixed(1)} out of 10, ${label.toLowerCase()}`}
      role="img"
    >
      <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--muted)" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          transform="rotate(-90 22 22)"
          className={BAND_TONE[band]}
        />
        <text
          x="22"
          y="26"
          textAnchor="middle"
          className="fill-foreground text-[13px] font-semibold tabular-nums"
        >
          {score.toFixed(1)}
        </text>
      </svg>
      <span className={cn("text-[10px] font-medium tracking-wide uppercase", BAND_TONE[band])}>
        {label}
      </span>
    </div>
  );
}
