import { SimulationView } from "@/components/portfolio/simulation-view";
import { PageHeader } from "@/components/ui/page-header";

export default function Page() {
  return (
    <section>
      <PageHeader
        title="Simulation"
        description="See the range of ways your portfolio could unfold, built from its own history."
      />
      <SimulationView />
    </section>
  );
}
