import { RebalanceView } from "@/components/portfolio/rebalance-view";
import { PageHeader } from "@/components/ui/page-header";

export default function Page() {
  return (
    <section>
      <PageHeader
        title="Rebalance Lab"
        description="Compare your weights with simple alternatives and see what concentrates your risk."
      />
      <RebalanceView />
    </section>
  );
}
