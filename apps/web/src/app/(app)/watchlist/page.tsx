import { PageHeader } from "@/components/ui/page-header";
import { WatchlistView } from "@/components/portfolio/watchlist-view";

export default function Page() {
  return (
    <section>
      <PageHeader
        title="Watchlist"
        description="A short list of companies to follow, with alerts when something unusual happens to one."
      />
      <WatchlistView />
    </section>
  );
}
