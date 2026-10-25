import { ForcesView } from "@/components/portfolio/forces-view";
import { PageHeader } from "@/components/ui/page-header";

export default function Page() {
  return (
    <section>
      <PageHeader
        title="What the forces did"
        description="Which hidden forces really moved stocks over the last year, and how much of your portfolio's return each one explains."
      />
      <ForcesView />
    </section>
  );
}
