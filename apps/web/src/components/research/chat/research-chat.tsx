"use client";

import {
  BarChart3,
  Layers,
  NotebookPen,
  Pin,
  RefreshCw,
  LayoutDashboard,
  MessageSquarePlus,
  Presentation,
  Square,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantEvent } from "@portfolio-lab/explain";
import { Button } from "@/components/ui/button";
import { api, ApiError, ensureSession } from "@/lib/api";
import { readNdjson } from "@/lib/ndjson";
import type { ChatMessage, ResearchMode, ThreadSummary } from "@/server/research-chat";
import { AnswerView } from "./answer-view";
import { ProgressView, type Step } from "./progress-view";
import { AnswerDashboard } from "./visualize";
import { ChangesView } from "./changes-view";

type StreamEvent =
  | AssistantEvent
  | { type: "thread"; threadId: string; title: string; created: boolean }
  | { type: "answer"; message: ChatMessage; disclaimer: string }
  | { type: "error"; message: string };

interface Running {
  question: string;
  mode: ResearchMode;
  steps: Step[];
  phase: string | null;
  controller: AbortController;
}

const SUGGESTIONS: { text: string; mode: ResearchMode; needsPortfolio?: boolean }[] = [
  { text: "What is the biggest risk in my portfolio?", mode: "quick", needsPortfolio: true },
  { text: "Give me a research brief on NVDA", mode: "deep" },
  { text: "Compare AAPL, MSFT and GOOGL on growth, margins and valuation", mode: "quick" },
  { text: "Which S&P 500 companies are most exposed to AI capital spending?", mode: "quick" },
  { text: "What does Apple's latest 10-K say about risks in China?", mode: "quick" },
  {
    text: "What is the latest news on Tesla, and how has the stock moved this month?",
    mode: "quick",
  },
];

/** Companies an answer looked up (not the market index), for the "fit to my portfolio" follow-up. */
export function tickersOf(answer: { toolCalls: { name: string; arguments: string }[] }): string[] {
  const out = new Set<string>();
  for (const c of answer.toolCalls) {
    if (/^(portfolio_fit|rank_fit)$/.test(c.name)) return [];
    try {
      const a = JSON.parse(c.arguments || "{}") as { ticker?: unknown; tickers?: unknown };
      for (const t of [a.ticker, ...(Array.isArray(a.tickers) ? a.tickers : [])])
        if (typeof t === "string" && /^[A-Za-z.\-]{1,10}$/.test(t) && t.toUpperCase() !== "SPY")
          out.add(t.toUpperCase());
    } catch {
      // A malformed call contributes nothing.
    }
  }
  return [...out].slice(0, 6);
}

async function postQuestion(body: object, signal: AbortSignal): Promise<Response> {
  const send = () =>
    fetch("/api/research/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  let res = await send();
  if (res.status === 401) {
    await ensureSession();
    res = await send();
  }
  if (!res.ok) {
    const e = (
      (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null
    )?.error;
    throw new ApiError(e?.code ?? "internal", e?.message ?? "Request failed", res.status);
  }
  return res;
}

export function ResearchChat() {
  const params = useSearchParams();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState<Running | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ResearchMode>("quick");
  const [portfolios, setPortfolios] = useState<{ id: string; name: string }[]>([]);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [visual, setVisual] = useState<Set<number>>(new Set());
  /** "messageId" for a whole answer, "messageId:D3" for one chart. */
  const [pins, setPins] = useState<Set<string>>(new Set());

  async function pin(messageId: number, displayId: string | null) {
    try {
      await api("/api/research/notebook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, displayId, portfolioId }),
      });
      setPins((p) => new Set(p).add(displayId ? `${messageId}:${displayId}` : String(messageId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not pin it");
    }
  }
  const bottom = useRef<HTMLDivElement>(null);
  const autoAsked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    ensureSession()
      .then(() =>
        Promise.all([
          api<{ threads: ThreadSummary[] }>("/api/research/threads"),
          api<{ portfolios: { id: string; name: string }[] }>("/api/portfolios"),
        ]),
      )
      .then(([t, p]) => {
        if (cancelled) return;
        setThreads(t.threads);
        setPortfolios(p.portfolios);
        setPortfolioId((cur) => cur ?? p.portfolios[0]?.id ?? null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, running?.steps.length, running?.phase]);

  const ask = useCallback(
    async (question: string, askMode: ResearchMode, refreshOf?: number) => {
      const q = question.trim();
      if (q.length < 3 || running) return;
      setError(null);
      setNotice(null);
      const controller = new AbortController();
      const optimistic: ChatMessage = {
        id: -Date.now(),
        role: "user",
        content: q,
        mode: askMode,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      setText("");
      setRunning({ question: q, mode: askMode, steps: [], phase: "Planning", controller });
      const update = (f: (r: Running) => Running) => setRunning((r) => (r ? f(r) : r));
      let answered = false;
      try {
        await ensureSession();
        const res = await postQuestion(
          { question: q, mode: askMode, threadId: threadId ?? undefined, portfolioId, refreshOf },
          controller.signal,
        );
        await readNdjson<StreamEvent>(res, (e) => {
          switch (e.type) {
            case "thread":
              setThreadId(e.threadId);
              setThreads((ts) => [
                {
                  id: e.threadId,
                  title: e.title,
                  portfolioId,
                  updatedAt: new Date().toISOString(),
                },
                ...ts.filter((t) => t.id !== e.threadId),
              ]);
              break;
            case "tool_start":
              update((r) => ({
                ...r,
                phase: null,
                steps: [
                  ...r.steps,
                  {
                    callId: `${r.steps.length}-${e.callId}`,
                    name: e.name,
                    arguments: e.arguments,
                    status: "running",
                    facts: 0,
                    hasDisplay: false,
                  },
                ],
              }));
              break;
            case "tool_done":
              update((r) => {
                const steps = [...r.steps];
                const i = steps.findLastIndex(
                  (s) => s.callId.endsWith(`-${e.callId}`) && s.status === "running",
                );
                if (i >= 0)
                  steps[i] = {
                    ...steps[i]!,
                    status: e.error ? "error" : "done",
                    facts: e.facts.length,
                    hasDisplay: e.displays.length > 0,
                    error: e.error ?? undefined,
                  };
                const busy = steps.some((s) => s.status === "running");
                return { ...r, steps, phase: busy ? null : "Thinking" };
              });
              break;
            case "checking":
              update((r) => ({ ...r, phase: "Checking every figure against the sources" }));
              break;
            case "retry":
              update((r) => ({
                ...r,
                phase: "Some figures did not match the sources. Trying again",
              }));
              break;
            case "answer":
              answered = true;
              setDisclaimer(e.disclaimer);
              setMessages((m) => [...m, e.message]);
              break;
            case "error":
              setError(e.message);
              break;
          }
        });
        if (!answered && !controller.signal.aborted)
          setError((cur) => cur ?? "The answer stopped early. Try again.");
      } catch (e) {
        if (controller.signal.aborted) {
          setNotice("Stopped. The question is kept in this conversation.");
        } else {
          setError(e instanceof Error ? e.message : "Something went wrong");
          // Nothing was stored when the request itself was refused, so put the question back.
          if (e instanceof ApiError) {
            setMessages((m) => m.filter((x) => x.id !== optimistic.id));
            setText(q);
          }
        }
      } finally {
        setRunning(null);
      }
    },
    [running, threadId, portfolioId],
  );

  useEffect(() => {
    const preset = params.get("ask");
    if (!preset || autoAsked.current) return;
    autoAsked.current = true;
    const m = params.get("mode") === "deep" ? "deep" : "quick";
    setMode(m);
    void ask(preset, m);
  }, [params, ask]);

  // "/research?thread=<id>" reopens a conversation, for links back from its dashboard or presentation.
  const openedFromLink = useRef(false);
  useEffect(() => {
    const id = params.get("thread");
    if (!id || openedFromLink.current) return;
    openedFromLink.current = true;
    void openThread(id);
    // openThread only reads state at call time; running it once on load is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function openThread(id: string) {
    if (running || id === threadId) return;
    setLoadingThread(true);
    setError(null);
    setNotice(null);
    try {
      const t = await api<{ thread: ThreadSummary; messages: ChatMessage[]; disclaimer: string }>(
        `/api/research/threads/${id}`,
      );
      setThreadId(id);
      setMessages(t.messages);
      setDisclaimer(t.disclaimer);
      if (t.thread.portfolioId && portfolios.some((p) => p.id === t.thread.portfolioId))
        setPortfolioId(t.thread.portfolioId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the conversation");
    } finally {
      setLoadingThread(false);
    }
  }

  function newChat() {
    if (running) return;
    setThreadId(null);
    setMessages([]);
    setError(null);
    setNotice(null);
  }

  async function removeThread(id: string) {
    try {
      await api(`/api/research/threads/${id}`, { method: "DELETE" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the conversation");
      return;
    }
    setThreads((ts) => ts.filter((t) => t.id !== id));
    if (id === threadId) newChat();
  }

  const empty = messages.length === 0 && !running;
  const threadList = (
    <nav aria-label="Conversations" className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start"
        onClick={newChat}
        disabled={!!running}
      >
        <MessageSquarePlus /> New conversation
      </Button>
      <Link
        href="/research/notebook"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
      >
        <NotebookPen className="size-3.5" aria-hidden /> Research notebook
      </Link>
      <ul className="space-y-0.5">
        {threads.map((t) => (
          <li key={t.id} className="group flex items-center gap-1">
            <button
              type="button"
              onClick={() => void openThread(t.id)}
              aria-current={t.id === threadId ? "true" : undefined}
              className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted ${
                t.id === threadId ? "bg-muted font-medium" : "text-muted-foreground"
              }`}
              title={t.title}
            >
              {t.title}
            </button>
            <button
              type="button"
              onClick={() => void removeThread(t.id)}
              aria-label={`Delete conversation: ${t.title}`}
              className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]" data-tour="assistant">
      <aside className="hidden lg:block">{threadList}</aside>
      <details className="rounded-md border px-3 py-2 lg:hidden">
        <summary className="cursor-pointer text-sm">Conversations ({threads.length})</summary>
        <div className="mt-2">{threadList}</div>
      </details>

      <div className="flex min-w-0 flex-col gap-4">
        {empty && (
          <div className="space-y-3 rounded-xl border p-4">
            <div>
              <h2 className="font-medium">Ask the research assistant</h2>
              <p className="text-sm text-muted-foreground">
                It reads our price, fundamental and exposure data, SEC filings and the web, and
                checks every number in its answer against what it found. Deep research plans the
                question and writes a longer report.
              </p>
            </div>
            <div role="group" aria-label="Suggested questions" className="flex flex-wrap gap-2">
              {SUGGESTIONS.filter((s) => !s.needsPortfolio || portfolioId).map((s) => (
                <button
                  key={s.text}
                  type="button"
                  onClick={() => {
                    setMode(s.mode);
                    void ask(s.text, s.mode);
                  }}
                  className="rounded-full border px-3 py-1 text-left text-xs hover:bg-muted"
                >
                  {s.text}
                  {s.mode === "deep" && <span className="ml-1 text-muted-foreground">(deep)</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {loadingThread && <p className="text-sm text-muted-foreground">Opening the conversation</p>}

        {threadId && messages.some((m) => m.role === "assistant") && !running && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Conversation views">
            <Link
              href={`/research/c/${threadId}/dashboard`}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
            >
              <LayoutDashboard className="size-3.5" aria-hidden /> Dashboard
            </Link>
            <Link
              href={`/research/c/${threadId}/deck`}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
            >
              <Presentation className="size-3.5" aria-hidden /> Presentation
            </Link>
          </div>
        )}

        <ol className="space-y-5" aria-label="Conversation">
          {messages.map((m) =>
            m.role === "user" ? (
              <li
                key={m.id}
                className="ml-auto max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
              >
                <span className="sr-only">You asked: </span>
                {m.content}
                {m.mode === "deep" && (
                  <span className="ml-2 text-xs text-muted-foreground">deep research</span>
                )}
              </li>
            ) : (
              <li key={m.id} className="rounded-xl border p-4">
                {m.answer.refresh && <ChangesView refresh={m.answer.refresh} />}
                <AnswerView answer={m.answer} />
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {m.answer.toolCalls.length > 0 && (
                    <span>
                      {m.answer.toolCalls.length} lookups, {m.answer.facts.length} sources
                    </span>
                  )}
                  <button
                    type="button"
                    aria-expanded={visual.has(m.id)}
                    onClick={() =>
                      setVisual((v) => {
                        const n = new Set(v);
                        if (n.has(m.id)) n.delete(m.id);
                        else n.add(m.id);
                        return n;
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-foreground hover:bg-muted"
                  >
                    <BarChart3 className="size-3.5" aria-hidden />
                    {visual.has(m.id) ? "Hide charts" : "Visualize"}
                  </button>
                  {portfolioId && !running && tickersOf(m.answer).length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const ts = tickersOf(m.answer);
                        void ask(
                          ts.length === 1
                            ? `How would ${ts[0]} fit my portfolio?`
                            : `How would ${ts.join(", ")} each fit my portfolio? Compare them.`,
                          "quick",
                        );
                      }}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-foreground hover:bg-muted"
                    >
                      <Layers className="size-3.5" aria-hidden />
                      Fit to my portfolio
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pins.has(String(m.id))}
                    onClick={() => void pin(m.id, null)}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-foreground hover:bg-muted disabled:opacity-100"
                  >
                    <Pin className="size-3.5" aria-hidden />
                    {pins.has(String(m.id)) ? "Pinned to notebook" : "Pin to notebook"}
                  </button>
                  {!running && threadId && (
                    <button
                      type="button"
                      onClick={() => {
                        const i = messages.findIndex((x) => x.id === m.id);
                        const q = messages[i - 1];
                        if (q?.role === "user") void ask(q.content, m.mode ?? "quick", m.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-foreground hover:bg-muted"
                    >
                      <RefreshCw className="size-3.5" aria-hidden />
                      Refresh
                    </button>
                  )}
                </div>
                {visual.has(m.id) && (
                  <section aria-label="Answer charts" className="mt-4 border-t pt-4">
                    <AnswerDashboard
                      onPin={(d) => void pin(m.id, d)}
                      pinned={
                        new Set(
                          [...pins]
                            .filter((k) => k.startsWith(`${m.id}:`))
                            .map((k) => k.slice(String(m.id).length + 1)),
                        )
                      }
                      facts={m.answer.facts}
                      displays={m.answer.allDisplays ?? m.answer.displays}
                    />
                  </section>
                )}
              </li>
            ),
          )}
          {running && (
            <li className="rounded-xl border p-4">
              <ProgressView steps={running.steps} phase={running.phase} />
            </li>
          )}
        </ol>
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div ref={bottom} />

        <form
          className="sticky bottom-2 space-y-2 rounded-xl border bg-background p-3 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text, mode);
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(text, mode);
              }
            }}
            aria-label="Your question"
            maxLength={2000}
            rows={2}
            placeholder={
              messages.length
                ? "Ask a follow-up"
                : "Ask about a company, a sector, a filing, or your portfolio"
            }
            className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="radiogroup"
              aria-label="Answer depth"
              className="flex rounded-lg border p-0.5 text-xs"
            >
              {(["quick", "deep"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-2.5 py-1 ${mode === m ? "bg-muted font-medium" : "text-muted-foreground"}`}
                >
                  {m === "quick" ? "Quick answer" : "Deep research"}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Portfolio
              <select
                value={portfolioId ?? ""}
                onChange={(e) => setPortfolioId(e.target.value || null)}
                className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value="">None</option>
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ml-auto">
              {running ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => running.controller.abort()}
                >
                  <Square /> Stop
                </Button>
              ) : (
                <Button type="submit" size="sm" disabled={text.trim().length < 3}>
                  Ask
                </Button>
              )}
            </div>
          </div>
        </form>
        {disclaimer && <p className="text-xs text-muted-foreground">{disclaimer}</p>}
      </div>
    </div>
  );
}
