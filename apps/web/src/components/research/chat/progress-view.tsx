"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";

export interface Step {
  callId: string;
  name: string;
  arguments: string;
  status: "running" | "done" | "error";
  facts: number;
  hasDisplay: boolean;
  error?: string;
}

function parse(a: string): Record<string, unknown> {
  try {
    return (JSON.parse(a || "{}") as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

const SECTION: Record<string, string> = {
  business: "Business",
  risk_factors: "Risk Factors",
  mdna: "MD&A",
  all: "full text",
};

/** A plain-English line for a tool call, so the reader can follow what the assistant is looking at. */
export function describeStep(name: string, args: string): string {
  const a = parse(args);
  const t = typeof a.ticker === "string" ? a.ticker.toUpperCase() : "";
  const list = Array.isArray(a.tickers) ? a.tickers.join(", ").toUpperCase() : "";
  switch (name) {
    case "find_companies":
      return `Looking up "${String(a.query ?? "")}"`;
    case "get_company":
      return `Reading the ${t} profile`;
    case "get_fundamentals":
      return `Reading ${t} annual figures`;
    case "price_history":
      return `Price history of ${list} (${String(a.period ?? "1y")})`;
    case "compare_companies":
      return `Comparing ${list}`;
    case "screen_companies":
      return "Screening the S&P 500";
    case "list_factors":
      return "Listing economic exposures";
    case "search_news":
      return `Searching news${t ? ` for ${t}` : ""}${a.query ? ` about "${String(a.query)}"` : ""}`;
    case "web_search":
      return `Searching the web: ${String(a.query ?? "")}`;
    case "read_web_page":
      return `Reading ${String(a.url ?? "a web page")}`;
    case "list_filings":
      return `Listing ${t} SEC filings`;
    case "read_filing":
      return `Reading ${t ? `${t} ` : ""}${String(a.form ?? "10-K")}${a.section ? `, ${SECTION[String(a.section)] ?? a.section}` : ""}${a.focus ? ` on "${String(a.focus)}"` : ""}`;
    case "compare_filings":
      return `Comparing ${t} ${String(a.form ?? "10-K")} ${SECTION[String(a.section ?? "risk_factors")] ?? ""} with the ${a.against === "year_ago" ? "year-ago" : "previous"} filing`;
    case "portfolio_fit":
      return `How ${t} fits your portfolio`;
    case "rank_fit":
      return `Ranking ${list} by fit with your portfolio`;
    case "get_correlation":
      return "Reading how your holdings move together";
    case "compare_to_market":
      return "Comparing your portfolio with the S&P 500";
    case "simulate_outcomes":
      return "Simulating possible paths";
    case "alternative_weightings":
      return "Trying other weightings on past prices";
    case "find_diversifiers":
      return "Screening for diversifiers";
    case "custom_scenario":
      return "Running your scenario";
    case "todays_move":
      return "Reading today's move";
    case "portfolio_insights":
      return "Reading portfolio alerts";
    case "get_watchlist":
      return "Reading your watchlist";
    case "search_filings":
      return `Searching SEC filings: ${String(a.query ?? "")}`;
    case "get_holdings":
      return "Reading your holdings";
    case "get_portfolio_summary":
      return "Reading your portfolio's figures";
    case "get_exposures":
      return "Reading your hidden exposures";
    case "get_portfolio_news":
      return "Reading news for your portfolio";
    case "what_if_add":
      return `What if you added ${t}`;
    case "run_stress":
      return `Stress scenario ${String(a.preset ?? "")}`;
    default:
      return name.replace(/_/g, " ");
  }
}

export function ProgressView({ steps, phase }: { steps: Step[]; phase: string | null }) {
  return (
    <div
      className="space-y-1 text-xs text-muted-foreground"
      aria-live="polite"
      aria-label="Research progress"
    >
      <ul className="space-y-1">
        {steps.map((s) => (
          <li key={s.callId} className="flex items-start gap-1.5">
            {s.status === "running" ? (
              <LoaderCircle
                className="mt-0.5 size-3.5 shrink-0 animate-spin"
                aria-label="Working"
              />
            ) : s.status === "error" ? (
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-label="Failed" />
            ) : (
              <Check className="mt-0.5 size-3.5 shrink-0 text-gain" aria-label="Done" />
            )}
            <span className="min-w-0 break-words">
              {describeStep(s.name, s.arguments)}
              {s.status === "done" &&
                s.facts > 0 &&
                ` (${s.facts} ${s.facts === 1 ? "source" : "sources"})`}
              {s.status === "error" && s.error && `: ${s.error}`}
            </span>
          </li>
        ))}
      </ul>
      {phase && (
        <p className="flex items-center gap-1.5">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> {phase}
        </p>
      )}
    </div>
  );
}
