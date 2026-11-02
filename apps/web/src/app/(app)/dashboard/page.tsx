import { PageHeader } from "@/components/ui/page-header";
import { Dashboard } from "@/components/portfolio/dashboard";

export default function Page() {
  return (
    <section className="space-y-0">
      <PageHeader
        title="Dashboard"
        description="How your portfolio is doing, what drove it, and what to watch."
      />
      <Dashboard />
    </section>
  );
}
