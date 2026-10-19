"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

interface Summary {
  id: string;
  name: string;
}

/** Loads the session's portfolios, lets the user pick one, and renders children for the selected id. */
export function WithPortfolio({
  children,
}: {
  children: (portfolioId: string) => React.ReactNode;
}) {
  const [list, setList] = useState<Summary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The session cookie is set by the layout bootstrap; retry once if this races it.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await api<{ portfolios: Summary[] }>("/api/portfolios");
          if (cancelled) return;
          setList(r.portfolios);
          setSelected(r.portfolios[0]?.id ?? null);
          return;
        } catch (e) {
          if (attempt === 1 || !(e instanceof ApiError && e.status === 401)) {
            if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
            return;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!list) return <p className="text-muted-foreground">Loading</p>;
  if (list.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">You have no portfolios yet.</p>
        <Button render={<Link href="/portfolios/new" />}>Create a portfolio</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {list.length > 1 && (
          <select
            aria-label="Portfolio"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <Button variant="outline" size="sm" render={<Link href="/portfolios/new" />}>
          New portfolio
        </Button>
      </div>
      {selected && children(selected)}
    </div>
  );
}
