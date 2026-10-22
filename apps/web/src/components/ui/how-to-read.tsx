import { CircleHelp } from "lucide-react";

/** A collapsed plain-language note: what the page shows, how to read it, and what to be careful about. */
export function HowToRead({
  children,
  title = "How to read this",
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <details className="group rounded-lg border bg-muted/40 px-4 py-2.5 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium select-none">
        <CircleHelp className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </summary>
      <div className="mt-2 max-w-3xl space-y-2 text-muted-foreground">{children}</div>
    </details>
  );
}
