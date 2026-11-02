"use client";

import { Database, FileText, Globe } from "lucide-react";
import { useId } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Fact } from "@portfolio-lab/explain";
import { linkCitations } from "@/lib/ndjson";
import type { StoredAnswer } from "@/server/research-chat";
import { DisplayView } from "./display-view";

const KIND_LABEL = { data: "Our data", web: "Web", filing: "SEC filing" } as const;
const KIND_ICON = { data: Database, web: Globe, filing: FileText } as const;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A citation marker. Hover or focus shows the fact; clicking jumps to it in the sources list. */
function Cite({ fact, anchor }: { fact: Fact | undefined; anchor: string }) {
  if (!fact) return null;
  const kind = fact.kind ?? "data";
  return (
    <a
      href={`#${anchor}-${fact.id}`}
      title={`${KIND_LABEL[kind]}: ${fact.label}: ${fact.text.slice(0, 200)}`}
      className={`mx-0.5 inline-flex items-center rounded px-1 align-super text-[0.65rem] leading-none font-medium no-underline ${
        kind === "web"
          ? "bg-info/15 text-info"
          : kind === "filing"
            ? "bg-warn/15 text-warn"
            : "bg-muted text-muted-foreground"
      }`}
    >
      {fact.id}
    </a>
  );
}

/** The sources an answer may cite, grouped by kind. Web and filing sources link out; our data shows the value. */
function Sources({ facts, anchor, cited }: { facts: Fact[]; anchor: string; cited: Set<string> }) {
  const groups = (["web", "filing", "data"] as const)
    .map((k) => ({ kind: k, items: facts.filter((f) => (f.kind ?? "data") === k) }))
    .filter((g) => g.items.length);
  if (!groups.length) return null;
  return (
    <details className="rounded-md border px-3 py-2" open={false}>
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Sources and figures ({facts.length}
        {cited.size ? `, ${cited.size} cited` : ""})
      </summary>
      <div className="mt-2 space-y-3">
        {groups.map((g) => {
          const Icon = KIND_ICON[g.kind];
          return (
            <div key={g.kind}>
              <div className="mb-1 flex items-center gap-1 text-xs font-medium">
                <Icon className="size-3.5" aria-hidden /> {KIND_LABEL[g.kind]}
              </div>
              <ul className="space-y-1 text-xs">
                {g.items.map((f) => (
                  <li
                    key={f.id}
                    id={`${anchor}-${f.id}`}
                    className="scroll-mt-24 rounded px-1 target:bg-info/10"
                  >
                    <span
                      className={`mr-1 font-mono ${cited.has(f.id) ? "font-semibold" : "text-muted-foreground"}`}
                    >
                      {f.id}
                    </span>
                    {f.source ? (
                      <>
                        <a
                          href={f.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {f.label}
                        </a>
                        <span className="text-muted-foreground"> ({hostOf(f.source.url)})</span>
                        <div className="text-muted-foreground">{f.text}</div>
                      </>
                    ) : (
                      <>
                        {f.label}: <span className="font-medium">{f.text}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </details>
  );
}

/** A stored or fresh answer: markdown with citation markers, chosen tables and charts, then the sources. */
export function AnswerView({ answer, disclaimer }: { answer: StoredAnswer; disclaimer?: string }) {
  const anchor = `a${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const byId = new Map(answer.facts.map((f) => [f.id, f]));
  const cited = new Set(
    [...answer.answer.matchAll(/F\d+/g)].map((m) => m[0]).filter((id) => byId.has(id)),
  );
  return (
    <div className="space-y-3" role="region" aria-label="Assistant answer">
      {answer.source === "fallback" && (
        <p className="text-muted-foreground">
          The written answer could not be verified against the sources, so only the figures are
          shown.
        </p>
      )}
      <div className="research-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith("#cite-"))
                return <Cite fact={byId.get(href.slice(6))} anchor={anchor} />;
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {children}
                </a>
              );
            },
            table: ({ children }) => (
              <div className="overflow-x-auto">
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {linkCitations(answer.answer)}
        </ReactMarkdown>
      </div>
      {answer.displays.length > 0 && (
        <div className="space-y-4">
          {answer.displays.map((d) => (
            <DisplayView key={d.id} display={d} />
          ))}
        </div>
      )}
      <Sources facts={answer.facts} anchor={anchor} cited={cited} />
      {disclaimer && <p className="text-xs text-muted-foreground">{disclaimer}</p>}
    </div>
  );
}
