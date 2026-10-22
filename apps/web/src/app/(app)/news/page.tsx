import { PageHeader } from "@/components/ui/page-header";
import { RadarView } from "@/components/portfolio/radar-view";

export default function Page() {
  return (
    <section className="space-y-0">
      <PageHeader
        title="News"
        description="Stories ranked by how much they matter to your portfolio."
      />
      <p className="text-muted-foreground">
        Fewer, more relevant stories: ranked by how much each one matters to the companies you hold.
      </p>
      <RadarView />
    </section>
  );
}
