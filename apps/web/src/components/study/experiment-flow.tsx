"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pct } from "@/lib/format";
import { CONSENT_POINTS, DEBRIEF_POINTS } from "./consent";
import { Loading } from "@/components/ui/skeleton";

interface Study {
  researcher: string;
  approval: string;
  contact: string;
  retention: string;
  end: string | null;
  allowMinors: boolean;
}

interface Result {
  nHoldings: number;
  effectiveSectors: number;
  effectiveFactors: number;
  topFactorShare: number;
}

interface Status {
  enabled: boolean;
  study?: Study | null;
  limits?: { minHoldings: number; maxHoldings: number; minWeightPct: number };
  participant?: {
    arm: "control" | "treatment";
    experience: string;
    completed: boolean;
    result: Result | null;
  } | null;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(body.error?.message ?? "Something went wrong");
  return body;
}

export function ExperimentFlow() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    call<Status>("/api/experiment")
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);
  useEffect(refresh, [refresh]);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!status) return <Loading />;
  if (!status.enabled) return <p>The study is not open right now.</p>;
  if (!status.participant) {
    if (!status.study) return <p>The study is not open yet.</p>;
    return <Consent study={status.study} onDone={refresh} />;
  }
  if (status.participant.completed)
    return (
      <Done
        arm={status.participant.arm}
        result={status.participant.result}
        end={status.study?.end ?? null}
        onWithdrawn={refresh}
      />
    );
  return <Task limits={status.limits!} onDone={refresh} onWithdrawn={refresh} />;
}

function Scale({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: number | null;
  onChange: (n: number) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">1 = not at all</span>
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <label key={n} className="flex items-center gap-1">
            <input type="radio" name={legend} checked={value === n} onChange={() => onChange(n)} />
            {n}
          </label>
        ))}
        <span className="text-muted-foreground">7 = completely</span>
      </div>
    </fieldset>
  );
}

function Consent({ study, onDone }: { study: Study; onDone: () => void }) {
  const [agree, setAgree] = useState(false);
  const [age, setAge] = useState<"adult" | "minor" | null>(null);
  const [guardian, setGuardian] = useState(false);
  const [experience, setExperience] = useState<string | null>(null);
  const [pd, setPd] = useState<number | null>(null);
  const [conf, setConf] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ageOk = age === "adult" || (age === "minor" && study.allowMinors && guardian);
  const ready = agree && ageOk && experience && pd && conf;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await call("/api/experiment/enroll", {
        method: "POST",
        body: JSON.stringify({
          consent: true,
          ageGroup: age,
          ...(age === "minor" ? { guardianConsent: guardian } : {}),
          experience,
          pre: { perceivedDiversification: pd, confidence: conf },
        }),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Before you start</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ul className="list-disc space-y-1 pl-5">
          {CONSENT_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
          <li>Your answers are kept as follows: {study.retention}</li>
        </ul>
        <dl
          className="grid gap-1 rounded-lg border p-3 sm:grid-cols-[10rem_1fr]"
          aria-label="About the study"
        >
          <dt className="text-muted-foreground">Researcher</dt>
          <dd>{study.researcher}</dd>
          <dt className="text-muted-foreground">Approved by</dt>
          <dd>{study.approval}</dd>
          <dt className="text-muted-foreground">Questions or concerns</dt>
          <dd>{study.contact}</dd>
        </dl>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">How old are you?</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="age"
                checked={age === "adult"}
                onChange={() => setAge("adult")}
              />
              18 or over
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="age"
                checked={age === "minor"}
                onChange={() => setAge("minor")}
              />
              Under 18
            </label>
          </div>
        </fieldset>
        {age === "minor" &&
          (study.allowMinors ? (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={guardian}
                onChange={(e) => setGuardian(e.target.checked)}
                className="mt-1"
              />
              <span>A parent or guardian has signed the consent form for this study.</span>
            </label>
          ) : (
            <p role="alert" className="text-destructive">
              This study is open to people aged 18 or over only. Thank you for your interest.
            </p>
          ))}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-1"
          />
          <span>I have read this information and agree to take part.</span>
        </label>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">
            How would you describe your investing experience?
          </legend>
          <div className="flex flex-wrap gap-4">
            {[
              ["novice", "New to investing"],
              ["intermediate", "Some experience"],
              ["expert", "Experienced"],
            ].map(([v, l]) => (
              <label key={v} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="experience"
                  checked={experience === v}
                  onChange={() => setExperience(v!)}
                />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        <Scale
          legend="How well diversified would you say you are as an investor?"
          value={pd}
          onChange={setPd}
        />
        <Scale
          legend="How confident are you in your ability to build a diversified portfolio?"
          value={conf}
          onChange={setConf}
        />
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Button disabled={!ready || busy} onClick={() => void start()}>
          {busy ? "Starting" : "Start the task"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Done({
  arm,
  result,
  end,
  onWithdrawn,
}: {
  arm: "control" | "treatment";
  result: Result | null;
  end: string | null;
  onWithdrawn: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 text-sm">
        <p>Thank you. Your answers have been recorded.</p>
        <h2 className="text-base font-semibold">About this study</h2>
        <ul className="list-disc space-y-1 pl-5">
          {DEBRIEF_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p data-testid="debrief-arm">
          You saw the version{" "}
          {arm === "treatment" ? "with hidden exposures" : "without hidden exposures"}.
        </p>
        {result && (
          <div className="rounded-lg border p-3" data-testid="debrief-result">
            <h3 className="font-medium">Your portfolio</h3>
            <p>
              Your {result.nHoldings} companies looked spread across{" "}
              <strong>{result.effectiveSectors.toFixed(1)}</strong> sectors, but depended on about{" "}
              <strong>{result.effectiveFactors.toFixed(1)}</strong> independent economic forces. The
              largest single force accounted for <strong>{pct(result.topFactorShare)}</strong> of
              its hidden exposure. The lower the second number is compared with the first, the less
              diversified a portfolio is than it looks.
            </p>
          </div>
        )}
        <p className="font-medium">
          Please do not discuss the study with anyone who might still take part
          {end ? ` before ${end}` : ""}: knowing what it tests would change their answers.
        </p>
        <WithdrawButton onWithdrawn={onWithdrawn} />
      </CardContent>
    </Card>
  );
}

function WithdrawButton({ onWithdrawn }: { onWithdrawn: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Withdraw and delete my data
      </Button>
    );
  return (
    <span className="flex items-center gap-2 text-sm">
      Delete everything stored about you?
      <Button
        variant="destructive"
        size="sm"
        onClick={() =>
          void call("/api/experiment/participant", { method: "DELETE" }).then(onWithdrawn)
        }
      >
        Confirm withdrawal
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}

interface Company {
  ticker: string;
  name: string;
  sector: string;
  volatility: number | null;
  exposures?: { factor: string; signed: number }[];
}

interface Preview {
  sectors: { sector: string; weight: number }[];
  effectiveSectors: number;
  volatility: number;
  averageCorrelation: number | null;
  factor?: {
    effectiveFactors: number | null;
    topFactorShare: number | null;
    loadings: { factor: string; net: number; share: number }[];
  };
}

function Task({
  limits,
  onDone,
  onWithdrawn,
}: {
  limits: NonNullable<Status["limits"]>;
  onDone: () => void;
  onWithdrawn: () => void;
}) {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [chosen, setChosen] = useState<{ ticker: string; weightPct: number }[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pd, setPd] = useState<number | null>(null);
  const [conf, setConf] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<{ type: string; payload?: Record<string, string | number | boolean> }[]>([]);

  const flush = useCallback(() => {
    const events = queue.current.splice(0, 50);
    if (events.length)
      void fetch("/api/experiment/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events }),
        keepalive: true,
      });
  }, []);
  const log = useCallback(
    (type: string, payload?: Record<string, string | number | boolean>) => {
      queue.current.push({ type, payload });
      if (queue.current.length >= 10) flush();
    },
    [flush],
  );

  useEffect(() => {
    void call<{ companies: Company[] }>("/api/experiment/universe")
      .then((r) => setCompanies(r.companies))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    const timer = setInterval(flush, 5000);
    const onVis = () => {
      log(document.hidden ? "page_hidden" : "page_visible");
      flush();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [flush, log]);

  const total = chosen.reduce((a, c) => a + c.weightPct, 0);
  const valid =
    chosen.length >= limits.minHoldings &&
    chosen.length <= limits.maxHoldings &&
    Math.abs(total - 100) <= 0.01 &&
    chosen.every((c) => c.weightPct >= limits.minWeightPct);
  const selectionKey = JSON.stringify(chosen);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const t = setTimeout(() => {
      call<Preview>("/api/experiment/preview", {
        method: "POST",
        body: `{"holdings":${selectionKey}}`,
      })
        .then((p) => !cancelled && setPreview(p))
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Preview failed"));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [valid, selectionKey]);

  function add(ticker: string) {
    if (chosen.length >= limits.maxHoldings || chosen.some((c) => c.ticker === ticker)) return;
    log("add_holding", { ticker });
    setChosen([...chosen, { ticker, weightPct: 0 }]);
  }
  function remove(ticker: string) {
    log("remove_holding", { ticker });
    setChosen(chosen.filter((c) => c.ticker !== ticker));
  }
  function equalise() {
    const each = Math.floor(10000 / chosen.length) / 100;
    const rest = Math.round((100 - each * chosen.length) * 100) / 100;
    setChosen(
      chosen.map((c, i) => ({
        ...c,
        weightPct: i === 0 ? Math.round((each + rest) * 100) / 100 : each,
      })),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    flush();
    try {
      await call("/api/experiment/submit", {
        method: "POST",
        body: JSON.stringify({
          holdings: chosen,
          post: { perceivedDiversification: pd, confidence: conf },
        }),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  if (!companies)
    return error ? (
      <p role="alert" className="text-destructive">
        {error}
      </p>
    ) : (
      <Loading />
    );
  const nameOf = (t: string) => companies.find((c) => c.ticker === t)?.name ?? t;
  const shownPreview = valid ? preview : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>Your task.</strong> A friend asks you to build a diversified portfolio of{" "}
            {limits.minHoldings} to {limits.maxHoldings} stocks for the next ten years. Choose
            companies from the list and set weights that add up to 100%, with at least{" "}
            {limits.minWeightPct}% in each. Aim for a portfolio that does not depend on one thing
            going right.
          </p>
          <WithdrawButton onWithdrawn={onWithdrawn} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Companies</CardTitle>
          </CardHeader>
          <CardContent>
            <ul aria-label="Companies" className="divide-y text-sm">
              {companies.map((c) => {
                const picked = chosen.some((x) => x.ticker === c.ticker);
                return (
                  <li key={c.ticker} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div>
                        <span className="font-medium">{c.ticker}</span> {c.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.sector} | volatility{" "}
                        {c.volatility === null ? "n/a" : pct(c.volatility, 0)}
                      </div>
                      {c.exposures && c.exposures.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Hidden exposures:{" "}
                          {c.exposures
                            .slice()
                            .sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed))
                            .slice(0, 3)
                            .map((e) => `${e.factor} ${e.signed > 0 ? "+" : ""}${e.signed}`)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={picked || chosen.length >= limits.maxHoldings}
                      aria-label={picked ? `Added ${c.ticker}` : `Add ${c.ticker}`}
                      onClick={() => add(c.ticker)}
                    >
                      {picked ? "Added" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your portfolio</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {chosen.length === 0 && (
                <p className="text-muted-foreground">Add companies from the list.</p>
              )}
              <ul aria-label="Your portfolio" className="space-y-2">
                {chosen.map((c) => (
                  <li key={c.ticker} className="flex items-center gap-2">
                    <span className="w-16 font-medium">{c.ticker}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {nameOf(c.ticker)}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={c.weightPct}
                      aria-label={`Weight for ${c.ticker} in percent`}
                      className="w-20 rounded-md border bg-background px-2 py-1 text-right"
                      onChange={(e) =>
                        setChosen(
                          chosen.map((x) =>
                            x.ticker === c.ticker ? { ...x, weightPct: Number(e.target.value) } : x,
                          ),
                        )
                      }
                      onBlur={() => log("set_weight", { ticker: c.ticker, weightPct: c.weightPct })}
                    />
                    <span>%</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${c.ticker}`}
                      onClick={() => remove(c.ticker)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
              {chosen.length > 0 && (
                <div className="flex items-center justify-between">
                  <span
                    data-testid="weight-total"
                    className={Math.abs(total - 100) <= 0.01 ? "" : "text-warn"}
                  >
                    Total {Math.round(total * 100) / 100}% of 100%
                  </span>
                  <Button size="sm" variant="outline" onClick={equalise}>
                    Equal weights
                  </Button>
                </div>
              )}
              {!valid && chosen.length > 0 && (
                <p className="text-muted-foreground">
                  Choose {limits.minHoldings} to {limits.maxHoldings} companies, at least{" "}
                  {limits.minWeightPct}% each, adding up to 100%, to see the portfolio summary.
                </p>
              )}
            </CardContent>
          </Card>

          {shownPreview && (
            <Card>
              <CardHeader>
                <CardTitle>Portfolio summary</CardTitle>
              </CardHeader>
              <CardContent
                className="space-y-3 text-sm"
                aria-label="Portfolio summary"
                role="region"
              >
                <dl className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-muted-foreground">Effective sectors</dt>
                    <dd className="font-semibold tabular-nums">
                      {shownPreview.effectiveSectors.toFixed(1)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Annualized volatility</dt>
                    <dd className="font-semibold tabular-nums">
                      {pct(shownPreview.volatility, 1)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Average correlation</dt>
                    <dd className="font-semibold tabular-nums">
                      {shownPreview.averageCorrelation === null
                        ? "n/a"
                        : shownPreview.averageCorrelation.toFixed(2)}
                    </dd>
                  </div>
                  {shownPreview.factor && (
                    <div>
                      <dt className="text-muted-foreground">Effective hidden factors</dt>
                      <dd className="font-semibold tabular-nums">
                        {shownPreview.factor.effectiveFactors?.toFixed(1) ?? "n/a"}
                      </dd>
                    </div>
                  )}
                </dl>
                <ul aria-label="Sector weights" className="space-y-0.5">
                  {shownPreview.sectors.map((s) => (
                    <li key={s.sector} className="flex justify-between">
                      <span>{s.sector}</span>
                      <span className="tabular-nums">{pct(s.weight, 0)}</span>
                    </li>
                  ))}
                </ul>
                {shownPreview.factor && (
                  <ul aria-label="Hidden exposure loadings" className="space-y-0.5">
                    {shownPreview.factor.loadings.slice(0, 5).map((l) => (
                      <li key={l.factor} className="flex justify-between">
                        <span>{l.factor}</span>
                        <span className="tabular-nums">{pct(l.share, 0)} of exposure</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>When you are done</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Scale
                legend="How well diversified is the portfolio you built?"
                value={pd}
                onChange={setPd}
              />
              <Scale
                legend="How confident are you in this portfolio?"
                value={conf}
                onChange={setConf}
              />
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <Button disabled={!valid || !pd || !conf || busy} onClick={() => void submit()}>
                {busy ? "Submitting" : "Submit portfolio"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
