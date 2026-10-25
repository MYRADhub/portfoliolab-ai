import { PrintButton, ReportView } from "@/components/portfolio/report-view";
import { PageHeader } from "@/components/ui/page-header";

export default function Page() {
  return (
    <section>
      <PageHeader
        className="print:hidden"
        title="Report"
        description="A one-page summary of a portfolio you can print or save as a PDF."
        actions={<PrintButton />}
      />
      <ReportView />
    </section>
  );
}
