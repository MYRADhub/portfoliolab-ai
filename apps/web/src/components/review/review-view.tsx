"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PROVENANCE_LABEL } from "@/lib/provenance";
import type { ReviewListItem, ReviewProfile, ReviewStatus } from "@/server/review";

const TOKEN_KEY = "pl-review-token";
const REVIEWER_KEY = "pl-reviewer";

function stored(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function remember(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the value then lasts until the page is closed.
  }
}

async function call<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "x-review-token": token,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const body = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(body.error?.message ?? "Something went wrong");
  return body;
}

const STATUS_TEXT: Record<ReviewStatus, string> = {
  draft: "AI draft",
  illustrative: "Illustrative",
  reviewed: "Reviewed",
  none: "No profile",
};

type Row = ReviewProfile["rows"][number];

export function ReviewView() {
  const [token, setToken] = useState(() => stored(TOKEN_KEY));
  const [entered, setEntered] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [status, setStatus] = useState<ReviewStatus | "all">("draft");
  const [q, setQ] = useState("");
  const [list, setList] = useState<ReviewListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // Bumped after a save or an unlock so the lists are fetched again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([
      call<Record<string, number>>(token, "/api/review/summary"),
      call<{ companies: ReviewListItem[] }>(
        token,
        `/api/review/companies?status=${status}&q=${encodeURIComponent(q)}&limit=200`,
      ),
    ])
      .then(([sum, l]) => {
        if (cancelled) return;
        setSummary(sum);
        setList(l.companies);
        setAuthed(true);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setAuthed(false);
        setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [token, status, q, version]);

  if (!authed)
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Reviewer access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            This tool changes the exposure scores everyone sees. Enter the review token set on the
            server.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              remember(TOKEN_KEY, entered);
              setToken(entered);
              setVersion((v) => v + 1);
            }}
          >
            <input
              type="password"
              aria-label="Review token"
              value={entered}
              onChange={(e) => setEntered(e.target.value)}
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2"
            />
            <Button type="submit" disabled={entered.length < 8}>
              Unlock
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-destructive">
              {error === "Not found" ? "The review tool is not enabled on this server." : error}
            </p>
          )}
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-6">
      {summary && (
        <p className="text-sm" data-testid="review-summary">
          {summary.companies} companies: {summary.draft} AI drafts to review, {summary.illustrative}{" "}
          illustrative, {summary.reviewed} reviewed, {summary.none} without a profile.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Companies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-2">
              <select
                aria-label="Status filter"
                value={status}
                onChange={(e) => setStatus(e.target.value as ReviewStatus | "all")}
                className="rounded-md border bg-background px-2 py-1.5"
              >
                <option value="draft">AI drafts</option>
                <option value="illustrative">Illustrative</option>
                <option value="reviewed">Reviewed</option>
                <option value="none">No profile</option>
                <option value="all">All</option>
              </select>
              <input
                type="search"
                aria-label="Search companies"
                placeholder="Ticker or name"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5"
              />
            </div>
            <ul
              aria-label="Companies to review"
              className="max-h-[28rem] divide-y overflow-y-auto"
              tabIndex={0}
            >
              {list.map((c) => (
                <li key={c.ticker}>
                  <button
                    type="button"
                    aria-pressed={selected === c.ticker}
                    onClick={() => setSelected(c.ticker)}
                    className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-muted ${selected === c.ticker ? "bg-accent" : ""}`}
                  >
                    <span>
                      <span className="font-medium">{c.ticker}</span>{" "}
                      <span className="text-muted-foreground">{c.name}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{STATUS_TEXT[c.status]}</span>
                  </button>
                </li>
              ))}
              {list.length === 0 && (
                <li className="px-2 py-3 text-muted-foreground">No companies match.</li>
              )}
            </ul>
          </CardContent>
        </Card>

        {selected ? (
          <Editor
            key={selected}
            token={token}
            ticker={selected}
            onSaved={() => setVersion((v) => v + 1)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Choose a company to review its exposure scores.
          </p>
        )}
      </div>
    </div>
  );
}

function Editor({
  token,
  ticker,
  onSaved,
}: {
  token: string;
  ticker: string;
  onSaved: () => void;
}) {
  const [profile, setProfile] = useState<ReviewProfile | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [reviewer, setReviewer] = useState(() => stored(REVIEWER_KEY));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState("");

  useEffect(() => {
    let cancelled = false;
    call<ReviewProfile>(token, `/api/review/companies/${ticker}`)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setRows(p.rows);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [token, ticker]);

  if (error && !profile)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!profile) return <p className="text-sm text-muted-foreground">Loading</p>;

  const name = (slug: string) => profile.forces.find((f) => f.slug === slug)?.name ?? slug;
  const edited = JSON.stringify(rows) !== JSON.stringify(profile.rows);
  const set = (slug: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.slug === slug ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    remember(REVIEWER_KEY, reviewer);
    try {
      const p = await call<ReviewProfile>(token, `/api/review/companies/${ticker}`, {
        method: "PUT",
        body: JSON.stringify({
          reviewer,
          rows: rows.map(({ slug, magnitude, direction, confidence, rationale }) => ({
            slug,
            magnitude,
            direction,
            confidence,
            rationale,
          })),
        }),
      });
      setProfile(p);
      setRows(p.rows);
      setSaved(`Saved as version ${p.version}, reviewed by ${p.reviewedBy}.`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const unused = profile.forces.filter((f) => !rows.some((r) => r.slug === f.slug));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {profile.company.ticker}{" "}
          <span className="font-normal text-muted-foreground">{profile.company.name}</span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {profile.company.sector ?? "Unclassified"} | {STATUS_TEXT[profile.status]} | version{" "}
          {profile.version}
          {profile.reviewedBy ? ` | reviewed by ${profile.reviewedBy}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {rows.length === 0 && (
          <p className="text-muted-foreground">
            No scores yet. Add the forces that clearly matter.
          </p>
        )}
        <ul aria-label="Exposure scores" className="space-y-3">
          {rows.map((r) => (
            <li key={r.slug} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{name(r.slug)}</span>
                {r.provenance !== "reviewed" && (
                  <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                    {PROVENANCE_LABEL[r.provenance]}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`Remove ${name(r.slug)}`}
                  onClick={() => setRows(rows.filter((x) => x.slug !== r.slug))}
                >
                  Remove
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1">
                  Strength
                  <select
                    aria-label={`Strength for ${name(r.slug)}`}
                    value={r.magnitude}
                    onChange={(e) => set(r.slug, { magnitude: Number(e.target.value) })}
                    className="rounded-md border bg-background px-2 py-1"
                  >
                    <option value={1}>1 minor</option>
                    <option value={2}>2 meaningful</option>
                    <option value={3}>3 central</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  When it rises
                  <select
                    aria-label={`Direction for ${name(r.slug)}`}
                    value={r.direction}
                    onChange={(e) => set(r.slug, { direction: Number(e.target.value) })}
                    className="rounded-md border bg-background px-2 py-1"
                  >
                    <option value={1}>the company gains</option>
                    <option value={-1}>the company loses</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  Confidence
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    aria-label={`Confidence for ${name(r.slug)}`}
                    value={r.confidence}
                    onChange={(e) => set(r.slug, { confidence: Number(e.target.value) })}
                    className="w-20 rounded-md border bg-background px-2 py-1"
                  />
                </label>
              </div>
              <input
                aria-label={`Reason for ${name(r.slug)}`}
                value={r.rationale}
                maxLength={300}
                onChange={(e) => set(r.slug, { rationale: e.target.value })}
                className="w-full rounded-md border bg-background px-2 py-1.5"
              />
            </li>
          ))}
        </ul>

        {unused.length > 0 && rows.length < 12 && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Force to add"
              value={add}
              onChange={(e) => setAdd(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5"
            >
              <option value="">Add a force...</option>
              {unused.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={!add}
              onClick={() => {
                setRows([
                  ...rows,
                  {
                    slug: add,
                    magnitude: 1,
                    direction: 1,
                    confidence: 0.5,
                    rationale: "",
                    provenance: "reviewed",
                  },
                ]);
                setAdd("");
              }}
            >
              Add
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <label className="flex flex-col gap-1">
            Your name (recorded with the review)
            <input
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              className="rounded-md border bg-background px-3 py-1.5"
            />
          </label>
          <Button
            disabled={busy || reviewer.trim().length < 2 || rows.some((r) => !r.rationale.trim())}
            onClick={() => void save()}
          >
            {edited ? "Save changes as reviewed" : "Accept as reviewed"}
          </Button>
          {edited && (
            <Button variant="ghost" onClick={() => setRows(profile.rows)}>
              Discard changes
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-gain">
            {saved}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Saving closes the current version and stores yours; earlier versions are kept. Rows need a
          reason a reader can check against a filing.
        </p>
      </CardContent>
    </Card>
  );
}
