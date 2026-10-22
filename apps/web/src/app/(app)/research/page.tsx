import { CompanySearch } from "@/components/research/company-search";
import { ResearchAssistant } from "@/components/research/research-assistant";

export default function Page() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Research</h1>
      <CompanySearch />
      <ResearchAssistant />
    </section>
  );
}
