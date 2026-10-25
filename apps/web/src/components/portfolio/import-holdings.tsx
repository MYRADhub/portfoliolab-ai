"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { pct } from "@/lib/format";
import { parseHoldings, type ImportKind, type ParsedImport } from "@/lib/import-holdings";
import type { ImportPreview } from "@/server/import";

const KIND_TEXT: Record<ImportKind, string> = {
  weights: "percentages of the portfolio",
  values: "dollar values",
  shares: "numbers of shares",
};

const EXAMPLE = "AAPL 25%\nMSFT 25%\nNVDA 20%\nJPM 15%\nXOM 15%";

/** Paste a list or a broker export (or load a CSV file), check what was understood, then create the portfolio. */
export function ImportHoldings() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ImportKind | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [name, setName] = useState("Imported portfolio");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(nextKind?: ImportKind) {
    setError(null);
    setPreview(null);
    const p = parseHoldings(text);
    setParsed(p);
    if (p.holdings.length === 0) {
      setError("No holdings found. Each line needs a ticker and a number, for example: AAPL 25%");
      return;
    }
    const k = nextKind ?? p.kind;
    setKind(k);
    setBusy(true);
    try {
      setPreview(
        await api<ImportPreview>("/api/import/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: k, holdings: p.holdings }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/portfolios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          normalize: true,
          holdings: preview.holdings.map((h) => ({ ticker: h.ticker, weightPct: h.weightPct })),
        }),
      });
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import from a spreadsheet or broker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Paste a list of holdings or an export from your broker. It understands percentages, dollar
          values and share counts, with or without a header row. Nothing is saved until you create
          the portfolio, and only tickers and numbers are sent.
        </p>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Paste holdings</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            spellCheck={false}
            placeholder={EXAMPLE}
            className="rounded-md border bg-background px-3 py-2 font-mono text-xs"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 hover:bg-muted">
            <FileUp className="size-4" aria-hidden="true" />
            <span>Load a CSV file</span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              className="sr-only"
              aria-label="Load a CSV file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setText(await f.text());
                e.target.value = "";
              }}
            />
          </label>
          <Button onClick={() => void check()} disabled={busy || !text.trim()}>
            Check holdings
          </Button>
          <Button variant="ghost" onClick={() => setText(EXAMPLE)}>
            Use an example
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}

        {parsed && kind && preview && (
          <div className="space-y-3" role="region" aria-label="Import preview">
            <fieldset className="flex flex-wrap items-center gap-3">
              <legend className="mb-1 font-medium">The numbers are</legend>
              {(Object.keys(KIND_TEXT) as ImportKind[]).map((k) => (
                <label key={k} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="import-kind"
                    checked={kind === k}
                    onChange={() => void check(k)}
                  />
                  {KIND_TEXT[k]}
                </label>
              ))}
            </fieldset>
            <p data-testid="import-summary">
              Understood {preview.holdings.length}{" "}
              {preview.holdings.length === 1 ? "holding" : "holdings"} as {KIND_TEXT[kind]}.
              {preview.unknown.length > 0 &&
                ` Left out because they are not in the S&P 500: ${preview.unknown.join(", ")}.`}
              {preview.noPrice.length > 0 &&
                ` Left out because no price is available: ${preview.noPrice.join(", ")}.`}
              {parsed.merged.length > 0 && ` Added together: ${parsed.merged.join(", ")}.`}
            </p>
            {parsed.skipped.length > 0 && (
              <details>
                <summary className="cursor-pointer text-muted-foreground">
                  {parsed.skipped.length} {parsed.skipped.length === 1 ? "line" : "lines"} skipped
                </summary>
                <ul className="mt-2 list-disc space-y-0.5 pl-5" aria-label="Skipped lines">
                  {parsed.skipped.map((s) => (
                    <li key={s.line}>
                      Line {s.line}: <span className="font-mono text-xs">{s.text}</span> ({s.reason}
                      )
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {preview.holdings.length > 0 && (
              <Table aria-label="Imported holdings">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Holding</TableHead>
                    <TableHead scope="col">Sector</TableHead>
                    <TableHead scope="col" className="text-right">
                      Weight
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.holdings.map((h) => (
                    <TableRow key={h.ticker}>
                      <TableCell>
                        <span className="font-medium">{h.ticker}</span>{" "}
                        <span className="text-muted-foreground">{h.name}</span>
                        {h.thinHistory && (
                          <span className="ml-2 text-xs text-warn">little price history</span>
                        )}
                      </TableCell>
                      <TableCell>{h.sector ?? "Unclassified"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct(h.weightPct / 100, 2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                Portfolio name
                <input
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-md border bg-background px-3 py-1.5"
                />
              </label>
              <Button
                onClick={() => void create()}
                disabled={busy || preview.holdings.length === 0 || !name.trim()}
              >
                Create portfolio
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
