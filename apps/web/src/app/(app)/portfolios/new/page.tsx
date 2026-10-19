import { PortfolioForm } from "@/components/portfolio/portfolio-form";

export default function NewPortfolioPage() {
  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">New portfolio</h1>
      <p className="mt-2 mb-6 text-muted-foreground">Enter your holdings and target weights.</p>
      <PortfolioForm />
    </section>
  );
}
