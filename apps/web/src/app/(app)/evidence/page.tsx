import { EvidenceView } from "@/components/portfolio/evidence-view";
import { PageHeader } from "@/components/ui/page-header";

export default function Page() {
  return (
    <section>
      <PageHeader
        title="Evidence"
        description="Does the idea behind PortfolioLab hold up? Each claim is tested on real data right now, with its limits."
      />
      <EvidenceView />
    </section>
  );
}
