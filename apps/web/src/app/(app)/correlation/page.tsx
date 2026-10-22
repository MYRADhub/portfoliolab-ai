import { PageHeader } from "@/components/ui/page-header";
import { CorrelationView } from "@/components/portfolio/correlation-view";

export default function Page() {
  return (
    <section className="space-y-0">
      <PageHeader
        title="Correlation"
        description="How your holdings move together, and whether diversification holds when markets fall."
      />
      <CorrelationView />
    </section>
  );
}
