import { Info } from "lucide-react";
import { pct } from "@/lib/format";
import type { ExposureCoverage } from "@/server/exposures";

/**
 * Says which holdings an exposure-based figure leaves out. Nothing when every holding has a profile. Exposure
 * profiles exist for only some companies, so most portfolios a visitor builds will show this.
 */
export function CoverageNote({ coverage, what }: { coverage: ExposureCoverage; what: string }) {
  if (coverage.missing.length === 0) return null;
  return (
    <p
      role="note"
      aria-label="Exposure coverage"
      className="flex gap-2 rounded-xl border border-info/40 bg-info-soft px-3 py-2 text-sm"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
      <span>
        {what} covers the {pct(coverage.share, 0)} of the portfolio with an exposure profile (
        {coverage.profiled} of {coverage.total} holdings), with their weights scaled up to 100%.
        Left out for lack of a profile:{" "}
        {coverage.missing.map((m, i) => (
          <span key={m.ticker}>
            {i > 0 && ", "}
            <strong>{m.ticker}</strong> ({pct(m.weight, 0)})
          </span>
        ))}
        .
      </span>
    </p>
  );
}

/** The message when too little of a portfolio is profiled for an exposure-based figure. */
export function NotEnoughCoverage({
  coverage,
  missingTickers,
  what,
}: {
  coverage?: ExposureCoverage;
  missingTickers: string[];
  what: string;
}) {
  return (
    <p>
      {what} needs exposure profiles for at least half of the portfolio
      {coverage ? `; only ${pct(coverage.share, 0)} is profiled` : ""}. Missing:{" "}
      <strong>{missingTickers.join(", ")}</strong>. Exposure profiles exist for a sample of large
      companies so far.
    </p>
  );
}
