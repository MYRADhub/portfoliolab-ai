import { PageHeader } from "@/components/ui/page-header";
import { TerminalView } from "@/components/portfolio/terminal-view";

export default function Page() {
  return (
    <section className="space-y-3">
      <PageHeader
        title="Terminal"
        description="Every chart and table for one portfolio, in four sections."
      />
      <TerminalView />
    </section>
  );
}
