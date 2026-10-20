"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { LoadSamplesResult, SampleDef } from "@/server/samples";

/** Posts to the sample loader. Shared by the picker and the empty state. */
export async function loadSamplePortfolios(keys?: string[]): Promise<LoadSamplesResult> {
  return api<LoadSamplesResult>("/api/samples", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(keys ? { keys } : {}),
  });
}

export function SamplePicker() {
  const router = useRouter();
  const { data, error } = useApi<{ samples: SampleDef[] }>("/api/samples");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function load(keys?: string[]) {
    setFailure(null);
    setBusy(keys?.[0] ?? "all");
    try {
      const r = await loadSamplePortfolios(keys);
      if (r.created.length === 0 && r.skipped.length > 0) {
        setFailure(r.skipped.map((s) => s.reason).join("; "));
        return;
      }
      router.push("/dashboard");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="samples" className="scroll-mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Or start from a sample</h2>
          <p className="text-sm text-muted-foreground">
            Ready-made portfolios for exploring the app. Each one illustrates a different idea.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={busy !== null}>
          {busy === "all" ? "Loading" : "Load all samples"}
        </Button>
      </div>
      {(failure || error) && (
        <p role="alert" className="text-sm text-destructive">
          {failure ?? error}
        </p>
      )}
      <ul className="grid gap-3 md:grid-cols-2" aria-label="Sample portfolios">
        {(data?.samples ?? []).map((s) => (
          <li key={s.key}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>{s.name.replace("Sample: ", "")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{s.blurb}</p>
                <p className="text-muted-foreground">{s.lesson}</p>
                <p className="text-muted-foreground">
                  {s.holdings.map((h) => `${h.ticker} ${h.weightPct}%`).join(", ")}
                </p>
                <Button
                  size="sm"
                  onClick={() => void load([s.key])}
                  disabled={busy !== null}
                  aria-label={`Load this sample: ${s.name.replace("Sample: ", "")}`}
                >
                  {busy === s.key ? "Loading" : "Load this sample"}
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
