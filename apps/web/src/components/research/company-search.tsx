"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Hit {
  ticker: string;
  name: string;
  sector: string | null;
}

export function CompanySearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<{ companies: Hit[] }>(`/api/companies?q=${encodeURIComponent(term)}`)
        .then((r) => {
          if (cancelled) return;
          setHits(r.companies);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Search failed"));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const shown = q.trim() ? hits : [];
  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Look up a company</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ticker or name, for example NVDA or Apple"
          className="rounded-md border bg-background px-3 py-2"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {q.trim() && shown.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">No matching companies.</p>
      )}
      {shown.length > 0 && (
        <ul aria-label="Search results" className="divide-y rounded-md border text-sm">
          {shown.map((h) => (
            <li key={h.ticker}>
              <Link
                href={`/research/${h.ticker}`}
                className="flex items-baseline gap-2 px-3 py-2 hover:bg-muted"
              >
                <span className="font-medium">{h.ticker}</span>
                <span>{h.name}</span>
                <span className="ml-auto text-muted-foreground">{h.sector ?? ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
