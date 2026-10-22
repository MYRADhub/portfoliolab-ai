"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pct } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { DiscoveryOutcome } from "@/server/discovery";
import { WithPortfolio } from "./with-portfolio";
import { HowToRead } from "@/components/ui/how-to-read";
import { Loading } from "@/components/ui/skeleton";

const weights = [0.03, 0.05, 0.1];

export function DiscoveryView() {
  return <WithPortfolio>{(id) => <Content key={id} id={id} />}</WithPortfolio>;
}

function Content({ id }: { id: string }) {
  const [weight, setWeight] = useState(0.05);
  const [sector, setSector] = useState("");
  const { data, error } = useApi<DiscoveryOutcome>(
    `/api/portfolios/${id}/discovery?weight=${weight}${sector ? `&sector=${encodeURIComponent(sector)}` : ""}`,
  );

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <Loading />;
  if (!data.available)
    return (
      <Card>
        <CardContent>
          <p>
            Discovery needs exposure profiles for every holding
            {data.missingTickers.length ? `; missing: ${data.missingTickers.join(", ")}` : ""}.
          </p>
        </CardContent>
      </Card>
    );

  const name = (slug: string) => data.factorNames[slug] ?? slug.replaceAll("_", " ");

  return (
    <div className="space-y-6">
      <HowToRead>
        <p>
          Discovery looks for companies that would spread your hidden exposures across more
          independent economic forces. &ldquo;Effective forces&rdquo; is the number of equally
          important forces your portfolio is really riding; a higher number means less dependence on
          any single one.
        </p>
        <p>
          A <strong>Hedge</strong> tag means adding the company lowers your total hidden exposure.
          That can reduce the effective number of forces even though your risk falls, so read the
          tag alongside the change. These are ideas for research only.
        </p>
      </HowToRead>
      <p className="max-w-3xl text-sm text-muted-foreground">
        These are research candidates, ranked by how much adding them would spread your hidden
        exposures across more independent forces. They are a diversification screen, not
        recommendations, and say nothing about expected return.
      </p>
      <div
        role="group"
        aria-label="Position size"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <span>If added at</span>
        {weights.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={weight === w}
            onClick={() => setWeight(w)}
            className={`rounded-md border px-3 py-1 ${weight === w ? "bg-muted font-medium" : ""}`}
          >
            {pct(w, 0)}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1">
          <span>Sector</span>
          <select
            aria-label="Sector filter"
            className="rounded-md border bg-background px-2 py-1"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
          >
            <option value="">All sectors</option>
            {data.sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span className="text-muted-foreground">
          Now: {data.before.effectiveFactors?.toFixed(1) ?? "n/a"} effective forces,{" "}
          {data.before.effectiveSectors.toFixed(1)} effective sectors.
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Candidates</CardTitle>
        </CardHeader>
        <CardContent>
          {data.candidates.length === 0 ? (
            <p>
              {sector
                ? "No candidates in this sector."
                : "No other companies have exposure profiles to compare."}
            </p>
          ) : (
            <Table aria-label="Research candidates">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Company</TableHead>
                  <TableHead scope="col">Sector</TableHead>
                  <TableHead scope="col" className="text-right">
                    Effective forces after
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Change
                  </TableHead>
                  <TableHead scope="col">Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.candidates.map((c) => (
                  <TableRow key={c.ticker}>
                    <TableCell>
                      <span className="font-medium">{c.ticker}</span>{" "}
                      <span className="text-muted-foreground">{c.name}</span>
                    </TableCell>
                    <TableCell>{c.sector ?? "Unclassified"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.effectiveFactorsAfter?.toFixed(2) ?? "n/a"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.deltaEffectiveFactors === null
                        ? "n/a"
                        : `${c.deltaEffectiveFactors >= 0 ? "+" : ""}${c.deltaEffectiveFactors.toFixed(2)}`}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.hedge && (
                        <span className="mr-1 rounded border px-1.5 py-0.5 text-xs font-medium">
                          Hedge
                        </span>
                      )}
                      {c.offsets.length > 0
                        ? `Leans against ${c.offsets.map(name).join(", ")}`
                        : `Adds ${c.adds.map(name).join(", ")}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Hedge means adding it lowers your total hidden exposure, which can reduce the effective
            number of forces even though risk falls.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
