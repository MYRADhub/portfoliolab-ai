import { PageHeader } from "@/components/ui/page-header";
import { Dashboard } from "@/components/portfolio/dashboard";

export default function Page() {
  return (
    <section className="space-y-0">
      <PageHeader
        title="Dashboard"
        description="Your portfolio at a glance: what changed, what to watch, and why."
      />
      <Dashboard />
    </section>
  );
}
