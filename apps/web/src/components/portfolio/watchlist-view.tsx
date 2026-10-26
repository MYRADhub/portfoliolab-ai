"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HowToRead } from "@/components/ui/how-to-read";
import { Loading } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { pct, signedPct } from "@/lib/format";
import type { Watchlist } from "@/server/watchlist";

const sp = (x: number | null) => (x === null ? "n/a" : signedPct(x, 1));
const tone = (x: number | null) =>
  x === null ? "" : x > 0 ? "text-gain" : x < 0 ? "text-loss" : "";

/** A short list of companies to follow, with plain-language alerts from fixed rules. */
export function WatchlistView() {
  const [list, setList] = useState<Watchlist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState("");
  const [hints, setHints] = useState<{ ticker: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Watchlist>("/api/watchlist")
      .then((d) => !cancelled && setList(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = ticker.trim();
    if (!q) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api<{ companies: { ticker: string; name: string }[] }>(
        `/api/companies?q=${encodeURIComponent(q)}`,
      )
        .then((r) => !cancelled && setHints(r.companies))
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ticker]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      setList(
        await api<Watchlist>("/api/watchlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ticker: t }),
        }),
      );
      setTicker("");
      setHints([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: string) {
    setError(null);
    try {
      await api(`/api/watchlist/${encodeURIComponent(t)}`, { method: "DELETE" });
      setList(await api<Watchlist>("/api/watchlist"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove");
    }
  }

  return (
    <div className="space-y-6">
      <HowToRead>
        <p>
          Keep a short list of companies you want to keep an eye on. Each one shows its latest price
          moves, how far it is from its 52-week high and low, and how many relevant news stories
          appeared in the last week.
        </p>
        <p>
          Alerts come from fixed rules, and each one states the figure that triggered it: a move of
          at least twice the stock&apos;s own normal daily swing, a fall of 10% or more over 21
          trading days, or a price within 3% of its 52-week high or low. They describe what
          happened, not what to do.
        </p>
      </HowToRead>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Company ticker
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            list="watch-hints"
            maxLength={10}
            autoComplete="off"
            className="w-44 rounded-md border bg-background px-2 py-1.5 uppercase"
          />
          <datalist id="watch-hints">
            {hints.map((h) => (
              <option key={h.ticker} value={h.ticker}>
                {h.name}
              </option>
            ))}
          </datalist>
        </label>
        <Button type="submit" disabled={busy || ticker.trim() === ""}>
          Add to watchlist
        </Button>
        {list && (
          <span className="text-xs text-muted-foreground">
            {list.items.length} of {list.max} used
          </span>
        )}
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!list && !error && <Loading rows={2} />}
      {list && list.items.length === 0 && (
        <Card>
          <CardContent>
            <p>
              Nothing on your watchlist yet. Add a ticker above, or open a company from{" "}
              <Link href="/research" className="underline underline-offset-2">
                Research
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {list && list.items.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              {list.alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="no-alerts">
                  Nothing unusual right now.
                </p>
              ) : (
                <ul className="space-y-1 text-sm" aria-label="Alerts">
                  {list.alerts.map((a) => (
                    <li key={`${a.ticker}-${a.alert.kind}`}>
                      <Link
                        href={`/research/${a.ticker}`}
                        className="font-semibold underline underline-offset-2"
                      >
                        {a.ticker}
                      </Link>{" "}
                      {a.alert.text}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Watching</CardTitle>
            </CardHeader>
            <CardContent>
              <Table aria-label="Watchlist">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Company</TableHead>
                    <TableHead scope="col" className="text-right">
                      Last
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      1 day
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      5 days
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      1 month
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      From 52-week high
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      News (7 days)
                    </TableHead>
                    <TableHead scope="col">
                      <span className="sr-only">Remove</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.items.map((i) => (
                    <TableRow key={i.ticker}>
                      <TableCell>
                        <Link
                          href={`/research/${i.ticker}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {i.ticker}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{i.name}</span>
                      </TableCell>
                      {i.signals ? (
                        <>
                          <TableCell className="text-right tabular-nums">
                            {i.signals.last.toFixed(2)}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${tone(i.signals.d1)}`}>
                            {sp(i.signals.d1)}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${tone(i.signals.d5)}`}>
                            {sp(i.signals.d5)}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${tone(i.signals.d21)}`}>
                            {sp(i.signals.d21)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pct(i.signals.fromHigh, 1)}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={5} className="text-muted-foreground">
                          Not enough price history yet.
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums">
                        {i.news.latest ? (
                          <a
                            href={i.news.latest.url}
                            title={i.news.latest.title}
                            className="underline underline-offset-2"
                            rel="noreferrer"
                            target="_blank"
                          >
                            {i.news.count}
                          </a>
                        ) : (
                          i.news.count
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${i.ticker}`}
                          onClick={() => void remove(i.ticker)}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
