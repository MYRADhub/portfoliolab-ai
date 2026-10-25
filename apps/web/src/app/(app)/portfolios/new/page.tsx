import { ImportHoldings } from "@/components/portfolio/import-holdings";
import { PortfolioForm } from "@/components/portfolio/portfolio-form";
import { SamplePicker } from "@/components/portfolio/sample-picker";

export default function NewPortfolioPage() {
  return (
    <div className="max-w-4xl space-y-10">
      <section className="max-w-2xl">
        <h1 className="text-2xl font-semibold">New portfolio</h1>
        <p className="mt-2 mb-6 text-muted-foreground">Enter your holdings and target weights.</p>
        <PortfolioForm />
      </section>
      <ImportHoldings />
      <SamplePicker />
    </div>
  );
}
