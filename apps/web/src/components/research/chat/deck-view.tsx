"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileDown,
  Maximize,
  NotebookText,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Fact, ShownDisplay, Slide } from "@portfolio-lab/explain";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Loading } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { linkCitations } from "@/lib/ndjson";
import type { StoredDeck } from "@/server/research-deck";
import { DisplayView } from "./display-view";

/** What one screen of the deck shows: the title slide, a content slide, or the sources slide. */
type Page =
  | { kind: "title"; title: string; subtitle: string; date: string }
  | { kind: "slide"; slide: Slide; display: ShownDisplay | null }
  | { kind: "sources"; facts: Fact[]; more: number };

const SOURCES_SHOWN = 14;

export function deckPages(deck: StoredDeck): Page[] {
  const displays = new Map(deck.displays.map((d) => [d.id, d]));
  const facts = new Map(deck.facts.map((f) => [f.id, f]));
  const text = deck.deck.slides.flatMap((s) => [s.title, ...s.bullets, s.notes]).join(" ");
  const cited = [...new Set([...text.matchAll(/F\d+/g)].map((m) => m[0]))]
    .map((id) => facts.get(id))
    .filter((f): f is Fact => !!f);
  return [
    {
      kind: "title",
      title: deck.deck.title,
      subtitle: deck.deck.subtitle,
      date: deck.createdAt.slice(0, 10),
    },
    ...deck.deck.slides.map((s) => ({
      kind: "slide" as const,
      slide: s,
      display: s.display ? (displays.get(s.display) ?? null) : null,
    })),
    {
      kind: "sources",
      facts: cited.slice(0, SOURCES_SHOWN),
      more: Math.max(0, cited.length - SOURCES_SHOWN),
    },
  ];
}

/** Markdown on one line, with citation groups as small markers that name the source on hover. */
function Inline({ text, facts }: { text: string; facts: Map<string, Fact> }) {
  return (
    <ReactMarkdown
      allowedElements={["p", "strong", "em", "a", "code"]}
      unwrapDisallowed
      components={{
        p: ({ children }) => <>{children}</>,
        a: ({ href, children }) => {
          const id = href?.startsWith("#cite-") ? href.slice(6) : null;
          if (!id) return <>{children}</>;
          const f = facts.get(id);
          return (
            <sup
              className="ml-0.5 text-[0.6em] text-muted-foreground"
              title={f ? `${f.label}: ${f.text.slice(0, 160)}` : undefined}
            >
              {id}
            </sup>
          );
        },
      }}
    >
      {linkCitations(text)}
    </ReactMarkdown>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SlideFace({
  page,
  index,
  total,
  facts,
  disclaimer,
}: {
  page: Page;
  index: number;
  total: number;
  facts: Map<string, Fact>;
  disclaimer: string;
}) {
  return (
    <div className="relative flex aspect-video w-full flex-col overflow-hidden rounded-xl border bg-card p-[4%] text-card-foreground shadow-sm print:break-inside-avoid print:shadow-none">
      {page.kind === "title" && (
        <div className="my-auto space-y-3">
          <h2 className="text-[clamp(1.4rem,3.4vw,2.6rem)] leading-tight font-semibold">
            <Inline text={page.title} facts={facts} />
          </h2>
          <p className="text-[clamp(0.9rem,1.6vw,1.25rem)] text-muted-foreground">
            <Inline text={page.subtitle} facts={facts} />
          </p>
          <p className="text-xs text-muted-foreground">
            PortfolioLab research, {page.date}. {disclaimer}
          </p>
        </div>
      )}
      {page.kind === "slide" && (
        <>
          <h2 className="mb-[2.5%] text-[clamp(1.1rem,2.3vw,1.8rem)] leading-tight font-semibold">
            <Inline text={page.slide.title} facts={facts} />
          </h2>
          <div
            className={`grid min-h-0 flex-1 gap-[3%] ${page.display ? "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : ""}`}
          >
            <ul className="list-disc space-y-[0.6em] pl-5 text-[clamp(0.8rem,1.35vw,1.1rem)] leading-snug">
              {page.slide.bullets.map((b, i) => (
                <li key={i}>
                  <Inline text={b} facts={facts} />
                </li>
              ))}
            </ul>
            {page.display && (
              <div className="min-h-0 overflow-hidden">
                <DisplayView display={page.display} />
              </div>
            )}
          </div>
        </>
      )}
      {page.kind === "sources" && (
        <>
          <h2 className="mb-3 text-[clamp(1.1rem,2.3vw,1.8rem)] font-semibold">Sources</h2>
          <ol className="min-h-0 flex-1 columns-1 space-y-1 overflow-hidden text-[clamp(0.6rem,0.95vw,0.8rem)] md:columns-2">
            {page.facts.map((f) => (
              <li key={f.id} className="break-inside-avoid">
                <span className="mr-1 font-mono text-muted-foreground">{f.id}</span>
                {f.source ? (
                  <>
                    {f.label}{" "}
                    <span className="text-muted-foreground">({hostOf(f.source.url)})</span>
                  </>
                ) : (
                  <>
                    {f.label}: {f.text}{" "}
                    <span className="text-muted-foreground">(PortfolioLab data)</span>
                  </>
                )}
              </li>
            ))}
          </ol>
          {page.more > 0 && (
            <p className="text-xs text-muted-foreground">and {page.more} more in the dashboard</p>
          )}
        </>
      )}
      <span className="absolute right-[2%] bottom-[2%] text-[0.65rem] text-muted-foreground">
        {index + 1} / {total}
      </span>
    </div>
  );
}

/** The presentation made from a conversation: make it, step through it, present it, or save it as PDF. */
export function DeckView({
  apiUrl,
  links,
  source,
}: {
  /** GET loads the stored deck, POST makes it again. */
  apiUrl: string;
  links: { href: string; label: string }[];
  /** What the deck is made from, for the descriptions: "conversation" or "notebook". */
  source: "conversation" | "notebook";
}) {
  const [deck, setDeck] = useState<StoredDeck | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [presenter, setPresenter] = useState(false);
  const [printing, setPrinting] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ deck: StoredDeck | null }>(apiUrl)
      .then((r) => !cancelled && setDeck(r.deck))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ deck: StoredDeck }>(apiUrl, {
        method: "POST",
      });
      setDeck(r.deck);
      setAt(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make the presentation");
    } finally {
      setBusy(false);
    }
  }

  const pages = deck ? deckPages(deck) : [];
  const total = pages.length;
  const go = useCallback(
    (d: number) => setAt((i) => Math.max(0, Math.min(total - 1, i + d))),
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // Charts measure their box, so every slide is laid out on screen before the print dialog opens.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 400);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);

  const header = (
    <div className="space-y-2 print:hidden">
      <div className="flex flex-wrap gap-3 text-sm">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="text-muted-foreground hover:underline">
            {l.label}
          </Link>
        ))}
      </div>
      <PageHeader
        title="Presentation"
        description={`Slides made from the verified answers in this ${source}. Every figure on them was checked against the sources.`}
      />
    </div>
  );

  if (deck === undefined && !error) return <Loading rows={3} />;

  if (!deck)
    return (
      <section className="space-y-4">
        {header}
        <div className="space-y-3 rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">
            No presentation yet. It is built from this {source}&apos;s verified answers, charts and
            sources, with speaker notes.
          </p>
          <Button onClick={() => void make()} disabled={busy}>
            {busy ? "Preparing slides and checking every figure" : "Prepare presentation"}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </section>
    );

  const facts = new Map(deck.facts.map((f) => [f.id, f]));
  const page = pages[Math.min(at, total - 1)]!;
  const next = pages[at + 1];

  if (printing)
    return (
      <section aria-label="Slides for printing" className="space-y-6 print:space-y-0">
        <style>{"@media print { @page { size: landscape; margin: 10mm; } }"}</style>
        <p className="text-sm text-muted-foreground print:hidden">Preparing the PDF</p>
        {pages.map((p, i) => (
          <div key={i} className="print:break-after-page">
            <SlideFace
              page={p}
              index={i}
              total={total}
              facts={facts}
              disclaimer={deck.disclaimer}
            />
          </div>
        ))}
      </section>
    );

  return (
    <section className="space-y-4">
      {header}
      {deck.source === "fallback" && (
        <p className="text-sm text-muted-foreground">
          The written slides could not be verified against the sources, so this deck shows the
          verified figures from each answer instead.
        </p>
      )}
      <div
        className="flex flex-wrap items-center gap-2"
        role="toolbar"
        aria-label="Presentation controls"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(-1)}
          disabled={at === 0}
          aria-label="Previous slide"
        >
          <ChevronLeft />
        </Button>
        <span className="text-sm tabular-nums" aria-live="polite">
          Slide {at + 1} of {total}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(1)}
          disabled={at >= total - 1}
          aria-label="Next slide"
        >
          <ChevronRight />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void stage.current?.requestFullscreen?.()}
        >
          <Maximize /> Present
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={presenter}
          onClick={() => setPresenter((v) => !v)}
        >
          <NotebookText /> Presenter view
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPrinting(true)}>
          <FileDown /> Save as PDF
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void make()} disabled={busy}>
          <RefreshCw /> {busy ? "Making again" : "Make again"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className={presenter ? "grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}>
        <div
          ref={stage}
          role="region"
          aria-roledescription="slide"
          aria-label={`Slide ${at + 1} of ${total}`}
          className="flex items-center justify-center bg-background [&:fullscreen]:p-8"
          onClick={(e) => {
            if (document.fullscreenElement) go(e.clientX > window.innerWidth / 2 ? 1 : -1);
          }}
        >
          <SlideFace
            page={page}
            index={at}
            total={total}
            facts={facts}
            disclaimer={deck.disclaimer}
          />
        </div>
        {presenter && (
          <aside aria-label="Speaker notes" className="space-y-3 rounded-xl border p-4 text-sm">
            <h2 className="font-medium">Notes</h2>
            <div className="leading-relaxed">
              {page.kind === "slide" ? (
                <Inline text={page.slide.notes} facts={facts} />
              ) : page.kind === "title" ? (
                "Introduce the question and say the figures come from PortfolioLab data, SEC filings and the web, each checked against its source."
              ) : (
                "Point to where each figure came from. Web and filing sources link to the original."
              )}
            </div>
            {next && (
              <p className="text-xs text-muted-foreground">
                Next:{" "}
                {next.kind === "slide"
                  ? next.slide.title
                  : next.kind === "sources"
                    ? "Sources"
                    : next.title}
              </p>
            )}
          </aside>
        )}
      </div>

      <ol className="flex gap-2 overflow-x-auto pb-2" aria-label="All slides">
        {pages.map((p, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => setAt(i)}
              aria-current={i === at ? "true" : undefined}
              className={`w-36 shrink-0 truncate rounded-md border px-2 py-1 text-left text-xs ${
                i === at ? "border-foreground font-medium" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {i + 1}.{" "}
              {p.kind === "slide" ? p.slide.title : p.kind === "title" ? "Title" : "Sources"}
            </button>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">{deck.disclaimer}</p>
    </section>
  );
}
