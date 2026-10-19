import { CorrelationView } from "@/components/portfolio/correlation-view";

export default function Page() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Correlation</h1>
      <CorrelationView />
    </section>
  );
}
