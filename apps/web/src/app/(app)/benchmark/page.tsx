import { BenchmarkView } from "@/components/portfolio/benchmark-view";
import { PageHeader } from "@/components/ui/page-header";

export default function Page() {
  return (
    <section>
      <PageHeader
        title="Market comparison"
        description="How your portfolio behaves compared with the S&P 500: beta, alpha and how much of the ups and downs you take."
      />
      <BenchmarkView />
    </section>
  );
}
