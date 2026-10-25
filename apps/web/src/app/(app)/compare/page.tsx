import { CompareView } from "@/components/portfolio/compare-view";
import { PageHeader } from "@/components/ui/page-header";

export default function Page() {
  return (
    <section>
      <PageHeader
        title="Compare"
        description="Put two of your portfolios side by side: performance, risk, hidden concentration and overlap."
      />
      <CompareView />
    </section>
  );
}
