import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { CompanySearch } from "@/components/research/company-search";
import { ResearchChat } from "@/components/research/chat/research-chat";
import { Loading } from "@/components/ui/skeleton";

export default function Page() {
  return (
    <section className="space-y-6">
      <PageHeader
        title="Research"
        description="Look up a company, or ask the research assistant about companies, filings, the news or your portfolio."
      />
      <CompanySearch />
      <Suspense fallback={<Loading rows={2} />}>
        <ResearchChat />
      </Suspense>
    </section>
  );
}
