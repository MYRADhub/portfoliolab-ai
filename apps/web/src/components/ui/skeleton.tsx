import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/** A loading placeholder shaped like a typical page: a row of tiles and a large block. Announces "Loading" to screen readers. */
export function Loading({ rows = 1, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("space-y-4", className)}>
      <span className="sr-only">Loading</span>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-48" />
      ))}
    </div>
  );
}
