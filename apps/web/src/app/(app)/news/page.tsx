import { PageHeader } from "@/components/ui/page-header";
import { RadarView } from "@/components/portfolio/radar-view";

export default function Page() {
  return (
    <section className="space-y-0">
      <PageHeader
        title="News"
        description="News about your holdings from every outlet we can find, ranked for your portfolio, with the reasoning behind each ranking."
      />
      <RadarView />
    </section>
  );
}
