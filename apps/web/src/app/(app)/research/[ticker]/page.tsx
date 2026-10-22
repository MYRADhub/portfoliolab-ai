import Link from "next/link";
import { Suspense } from "react";
import { CompanyView } from "@/components/research/company-view";

async function Company({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <CompanyView ticker={ticker.toUpperCase()} />;
}

export default function Page({ params }: { params: Promise<{ ticker: string }> }) {
  return (
    <section className="space-y-4">
      <Link href="/research" className="text-sm text-muted-foreground hover:underline">
        Back to Research
      </Link>
      <Suspense fallback={<p className="text-muted-foreground">Loading</p>}>
        <Company params={params} />
      </Suspense>
    </section>
  );
}
