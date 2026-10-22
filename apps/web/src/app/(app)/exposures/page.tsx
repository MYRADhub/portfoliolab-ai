import { PageHeader } from "@/components/ui/page-header";
import { ExposureView } from "@/components/portfolio/exposure-view";

export default function Page() {
  return (
    <section className="space-y-0">
      <PageHeader
        title="Exposures"
        description="The hidden economic forces your holdings share, and how concentrated you really are."
      />
      <ExposureView />
    </section>
  );
}
