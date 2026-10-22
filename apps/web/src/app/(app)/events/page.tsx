import { PageHeader } from "@/components/ui/page-header";
import { EventsView } from "@/components/portfolio/events-view";

export default function Page() {
  return (
    <section className="space-y-0">
      <PageHeader
        title="Reactions"
        description="How stocks actually moved around classified news and SEC filings."
      />
      <EventsView />
    </section>
  );
}
