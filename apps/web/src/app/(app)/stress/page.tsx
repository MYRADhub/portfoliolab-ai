import { PageHeader } from "@/components/ui/page-header";
import { StressView } from "@/components/portfolio/stress-view";

export default function Page() {
  return (
    <section className="space-y-0">
      <PageHeader
        title="Stress Lab"
        description="Test your portfolio against economic scenarios."
      />
      <StressView />
    </section>
  );
}
