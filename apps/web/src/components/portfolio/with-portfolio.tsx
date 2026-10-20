"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, ensureSession } from "@/lib/api";
import { loadSamplePortfolios } from "./sample-picker";

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

  const [version, setVersion] = useState(0);
  const reload = async (deletedId: string) => {
    setList((l) => (l ? l.filter((p) => p.id !== deletedId) : l));
    setSelected((cur) => (cur === deletedId ? null : cur));
    setVersion((v) => v + 1);
  };

  useEffect(() => {
    let cancelled = false;
    ensureSession()
      .then(() => api<{ portfolios: Summary[] }>("/api/portfolios"))
      .then((r) => {
        if (cancelled) return;
        setList(r.portfolios);
        setSelected(r.portfolios[0]?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!list) return <p className="text-muted-foreground">Loading</p>;
  if (list.length === 0) {
    return <EmptyState onLoaded={() => setVersion((v) => v + 1)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
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
        <Link href="/portfolios/new" className={buttonVariants({ variant: "outline", size: "sm" })}>
          New portfolio
        </Link>
        {selected && (
          <DeleteButton key={selected} id={selected} onDeleted={() => void reload(selected)} />
        )}
      </div>
      {selected && children(selected)}
    </div>
  );
}

/** Two-step delete so a stray click cannot remove a portfolio. */
function DeleteButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    try {
      await api(`/api/portfolios/${id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Delete
        </Button>
        {error && (
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
        )}
      </>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      Delete this portfolio?
      <Button variant="destructive" size="sm" onClick={() => void remove()}>
        Confirm delete
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}

function EmptyState({ onLoaded }: { onLoaded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const r = await loadSamplePortfolios();
      if (r.created.length === 0 && r.skipped.length > 0)
        setError(r.skipped.map((s) => s.reason).join("; "));
      else onLoaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <p>You have no portfolios yet.</p>
      <p className="text-muted-foreground">
        Build your own, or load five sample portfolios to explore the app straight away. New here?
        The guide explains everything in plain language.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/portfolios/new" className={buttonVariants()}>
          Create a portfolio
        </Link>
        <Button variant="outline" onClick={() => void load()} disabled={busy}>
          {busy ? "Loading" : "Load sample portfolios"}
        </Button>
        <Link href="/guide" className={buttonVariants({ variant: "ghost" })}>
          Read the guide
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
