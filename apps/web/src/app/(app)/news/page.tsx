import { RadarView } from "@/components/portfolio/radar-view";

export default function Page() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">News</h1>
      <p className="text-muted-foreground">
        Fewer, more relevant stories: ranked by how much each one matters to the companies you hold.
      </p>
      <RadarView />
    </section>
  );
}
