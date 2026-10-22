import { cn } from "@/lib/utils";

export type NewsClassKey = "fundamental" | "narrative" | "noise" | "unclear" | "unclassified";

export const CLASS_STYLE: Record<
  NewsClassKey,
  { label: string; icon: string; tone: string; meaning: string }
> = {
  fundamental: {
    label: "Fundamental",
    icon: "◆",
    tone: "bg-info-soft text-info",
    meaning: "Could change a company's revenue, costs or risk",
  },
  narrative: {
    label: "Narrative",
    icon: "◐",
    tone: "bg-warn-soft text-warn",
    meaning: "Changes opinions; the effect on the business is unclear",
  },
  noise: {
    label: "Noise",
    icon: "○",
    tone: "bg-muted text-foreground",
    meaning: "Attention only; no clear effect on the business",
  },
  unclear: {
    label: "Unclear",
    icon: "?",
    tone: "bg-muted text-foreground",
    meaning: "Too little information to judge",
  },
  unclassified: {
    label: "Not yet classified",
    icon: "·",
    tone: "bg-muted text-foreground",
    meaning: "Waiting to be classified",
  },
};

export function toClassKey(c: string | null | undefined): NewsClassKey {
  return c === "fundamental" || c === "narrative" || c === "noise" || c === "unclear"
    ? c
    : "unclassified";
}

/** The type of a story, with a distinct symbol and word so color is never the only cue. */
export function ClassBadge({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const s = CLASS_STYLE[toClassKey(value)];
  return (
    <span
      title={s.meaning}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        s.tone,
        className,
      )}
    >
      <span aria-hidden="true">{s.icon}</span>
      {s.label}
    </span>
  );
}
