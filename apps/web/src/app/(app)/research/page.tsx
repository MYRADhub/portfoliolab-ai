import { PageHeader } from "@/components/ui/page-header";
import { CompanySearch } from "@/components/research/company-search";
import { ResearchAssistant } from "@/components/research/research-assistant";

export default function Page() {
  return (
    <section className="space-y-6">
      <PageHeader
        title="Research"
        description="Look up a company or ask a question about your portfolio."
      />
      <CompanySearch />
      <ResearchAssistant />
    </section>
  );
}
