"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";

interface Row {
  key: number;
  ticker: string;
  weight: string;
}

const starter: Row[] = [
  { key: 1, ticker: "", weight: "" },
  { key: 2, ticker: "", weight: "" },
];

export function PortfolioForm() {
  const router = useRouter();
  const listId = useId();
  const [name, setName] = useState("My portfolio");
  const [rows, setRows] = useState<Row[]>(starter);
  const [normalize, setNormalize] = useState(false);
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const total = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function onTicker(key: number, value: string) {
    update(key, { ticker: value.toUpperCase() });
    if (value.length >= 1) {
      const r = await api<{ companies: { ticker: string; name: string }[] }>(
        `/api/companies?q=${encodeURIComponent(value)}`,
      ).catch(() => ({ companies: [] }));
      setSuggestions(r.companies);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const holdings = rows
        .filter((r) => r.ticker.trim() || r.weight.trim())
        .map((r) => ({ ticker: r.ticker.trim(), weightPct: Number(r.weight) }));
      await api("/api/portfolios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, normalize, holdings }),
      });
      router.push("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "bad_request" && err.message === "Invalid request"
          ? "Check that every row has a valid ticker and a numeric weight."
          : err instanceof Error
            ? err.message
            : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
      </div>

      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s.ticker} value={s.ticker}>
            {s.name}
          </option>
        ))}
      </datalist>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_8rem_2.5rem] gap-2 text-sm text-muted-foreground">
          <span>Ticker</span>
          <span>Weight (%)</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[1fr_8rem_2.5rem] gap-2">
            <Input
              aria-label={`Ticker ${i + 1}`}
              list={listId}
              value={r.ticker}
              onChange={(e) => void onTicker(r.key, e.target.value)}
              placeholder="NVDA"
            />
            <Input
              aria-label={`Weight ${i + 1}`}
              inputMode="decimal"
              value={r.weight}
              onChange={(e) => update(r.key, { weight: e.target.value })}
              placeholder="25"
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remove row ${i + 1}`}
              disabled={rows.length <= 1}
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            >
              x
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { key: Math.max(...rs.map((r) => r.key)) + 1, ticker: "", weight: "" },
            ])
          }
        >
          Add holding
        </Button>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span
          className={Math.abs(total - 100) < 0.01 ? "text-foreground" : "text-muted-foreground"}
        >
          Total: {total.toFixed(2)}%
        </span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={normalize}
            onChange={(e) => setNormalize(e.target.checked)}
          />
          Rescale weights to 100%
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={busy}>
        {busy ? "Creating" : "Create portfolio"}
      </Button>
    </form>
  );
}
