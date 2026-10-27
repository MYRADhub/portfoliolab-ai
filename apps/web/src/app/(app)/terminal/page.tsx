import { TerminalView } from "@/components/portfolio/terminal-view";

export default function Page() {
  return (
    <section className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-baseline gap-3">
        <h1 className="text-sm font-semibold tracking-widest uppercase">Terminal</h1>
        <p className="truncate text-xs text-muted-foreground">
          Every chart and table for one portfolio, on one screen per section.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <TerminalView />
      </div>
    </section>
  );
}
