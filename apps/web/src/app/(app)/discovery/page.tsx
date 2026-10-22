import { PageHeader } from "@/components/ui/page-header";
import { DiscoveryView } from "@/components/portfolio/discovery-view";

export default function Page() {
  return (
    <section className="space-y-0">
      <PageHeader
        title="Discovery"
        description="Companies that would spread your hidden exposures across more forces."
      />
      <DiscoveryView />
    </section>
  );
}
