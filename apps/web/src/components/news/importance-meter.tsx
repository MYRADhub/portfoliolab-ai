import { cn } from "@/lib/utils";

/** Ten small blocks: how much a story could change a company's economics (the classifier's importance, 0 to 10). */
export function ImportanceMeter({ value, tone = "bg-info" }: { value: number; tone?: string }) {
  const v = Math.max(0, Math.min(10, Math.round(value)));
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`Importance ${v} out of 10`}>
      <div className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={cn("h-2 w-2 rounded-[2px]", i < v ? tone : "bg-muted")} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{v}/10</span>
    </div>
  );
}
