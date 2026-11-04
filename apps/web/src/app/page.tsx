import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  ChartLine,
  Database,
  FileSearch,
  FileText,
  Gauge,
  Layers,
  Newspaper,
  Presentation,
  Scale,
  ShieldCheck,
  Shuffle,
  Sigma,
  Telescope,
} from "lucide-react";
import { Shot, type ShotName } from "@/components/landing/shot";
import { BrandMark } from "@/components/layout/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "PortfolioLab: research the hidden risks in your portfolio",
  description:
    "Real S&P 500 prices, SEC filings and news, explained in plain words. A research assistant whose every figure is checked against its sources, news ranked by what it means for your holdings, and presentations you can deliver.",
};

const FEATURES: {
  id: string;
  icon: typeof Bot;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  shot: ShotName;
  alt: string;
}[] = [
  {
    id: "dashboard",
    icon: Gauge,
    eyebrow: "Dashboard",
    title: "How you are doing, and why, in plain words",
    body: "The dashboard opens with a summary written from your own figures: how the month went, how that compares with the S&P 500, which holdings helped and which held you back, and where the risk really sits.",
    points: [
      "Returns, volatility and worst fall, each explained in one line",
      "You against the S&P 500 over any range",
      "Each holding's share of the ups and downs, flagged when it outweighs its size",
    ],
    shot: "dashboard",
    alt: "The PortfolioLab dashboard: a written summary of the month, four key figures, and a chart of the portfolio against the S&P 500.",
  },
  {
    id: "news",
    icon: Newspaper,
    eyebrow: "News",
    title: "News ranked by what it means for you, with the reasoning shown",
    body: "Stories from a news feed and the open web are grouped across outlets, linked to the companies they are about, and classified by AI. Every story opens to show exactly how it was judged.",
    points: [
      "Which outlets covered it, and who reported first",
      "Why it is linked to each holding, and how confident that link is",
      "The relevance arithmetic step by step, and how the stock moved against the market",
    ],
    shot: "news",
    alt: "A news story opened to show its coverage, the holdings it is linked to, the AI classification and the relevance score.",
  },
  {
    id: "research",
    icon: Bot,
    eyebrow: "Research assistant",
    title: "Answers you can check, figure by figure",
    body: "Ask about any S&P 500 company or your own portfolio. The assistant works with about thirty tools, from prices and fundamentals to SEC filings and web search, and every number in its answer must appear in a cited source before you see it.",
    points: [
      "Charts and tables built from the data, not drawn by the model",
      "Compares filings year over year and shows what changed",
      "Quick answers or deep research, saved as conversations you can return to",
    ],
    shot: "research",
    alt: "A research answer comparing NVIDIA and AMD, with citation markers, a price chart and a table of portfolio risk with and without AMD.",
  },
  {
    id: "fit",
    icon: Layers,
    eyebrow: "Portfolio fit",
    title: "See how a company would change your portfolio before you add it",
    body: "For any company, PortfolioLab runs your portfolio with and without it over the last year: return, volatility, worst fall and market sensitivity, plus how it moves with each of your holdings.",
    points: [
      "A backtest with constant weights, labelled as history, not a forecast",
      "Correlation with every holding, sector concentration and overlaps",
      "Stress scenarios before and after",
    ],
    shot: "fit",
    alt: "The portfolio fit for AMD: a table of the portfolio with and without AMD, and a chart of AMD's correlation with each holding.",
  },
  {
    id: "decks",
    icon: Presentation,
    eyebrow: "Presentations",
    title: "Turn a conversation into slides you can present",
    body: "One click turns a research conversation into a deck. The slides go through the same check as the answers, so every figure on them traces back to a source.",
    points: [
      "Charts from the conversation placed on the slides",
      "Presenter view with speaker notes, full screen, and save as PDF",
      "Build a deck from a whole research notebook, too",
    ],
    shot: "deck",
    alt: "A generated presentation slide with three cited bullet points and a chart of NVIDIA, AMD and the S&P 500.",
  },
];

const TOOLS: { icon: typeof Bot; name: string; text: string }[] = [
  { icon: Sigma, name: "Exposures", text: "The economic forces behind your holdings" },
  { icon: Shuffle, name: "Correlation", text: "Which holdings move together" },
  { icon: ShieldCheck, name: "Stress Lab", text: "Your portfolio under preset and custom shocks" },
  { icon: ChartLine, name: "Market comparison", text: "Against the S&P 500 and its sectors" },
  { icon: Scale, name: "Rebalance Lab", text: "What a weight cap would change" },
  { icon: Telescope, name: "Simulation", text: "A range of outcomes from history" },
  { icon: FileSearch, name: "Reactions", text: "How stocks moved after kinds of news" },
  { icon: FileText, name: "Report", text: "Everything in one printable page" },
];

const STEPS = [
  {
    title: "Tools fetch the facts",
    text: "Prices, fundamentals, filings, news and web pages come back as numbered facts with their sources.",
  },
  {
    title: "The answer cites them",
    text: "The assistant writes its answer and marks every figure with the fact it came from.",
  },
  {
    title: "A check runs before you see it",
    text: "Any number that is not in a cited fact sends the answer back to be fixed; if it still fails, you get the facts themselves instead.",
  },
];

const SOURCES = [
  {
    name: "Prices",
    text: "Five years of daily prices for every S&P 500 company, refreshed each trading day",
  },
  { name: "SEC EDGAR", text: "8-K events, annual fundamentals, and 10-K and 10-Q sections" },
  { name: "News", text: "A financial news feed plus web search, grouped and classified each day" },
  {
    name: "AI",
    text: "OpenAI models for the assistant, classification and slides, always checked against the data",
  },
  {
    name: "Exposure profiles",
    text: "Illustrative for now: a sample of large companies has example scores, and the app says where a profile is missing",
  },
];

const appLink = cn(buttonVariants({ size: "lg" }), "h-11 gap-2 rounded-xl px-5 text-base");

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="sr-only">Home: </span>
            <BrandMark />
            <span className="text-base font-semibold tracking-tight">PortfolioLab</span>
          </Link>
          <nav aria-label="Landing" className="hidden items-center gap-6 text-sm md:flex">
            <a href="#features" className="text-muted-foreground hover:text-foreground">
              Features
            </a>
            <a href="#checked" className="text-muted-foreground hover:text-foreground">
              How answers are checked
            </a>
            <a href="#data" className="text-muted-foreground hover:text-foreground">
              Data
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden w-36 sm:block">
              <ThemeToggle />
            </div>
            <Link href="/dashboard" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
              Open the app <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-40 h-[36rem] bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_65%)]"
          />
          <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-12 text-center sm:px-6 sm:pt-24">
            <p className="mx-auto inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
              <BadgeCheck className="size-3.5 text-primary" aria-hidden="true" />
              Every figure in every answer is checked against its source
            </p>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Research the hidden risks in your portfolio
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
              Real prices, SEC filings and the day&rsquo;s news for every S&amp;P 500 company,
              explained in plain words. Ask questions, see what the news means for your holdings,
              test a company before you add it, and turn the results into a presentation.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/dashboard" className={appLink}>
                Open the app <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <a
                href="#features"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 rounded-xl px-5 text-base",
                )}
              >
                See what it does
              </a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              No sign-up. You start with example portfolios you can change or replace.
            </p>
          </div>
          <div className="relative mx-auto max-w-6xl px-4 pb-20 sm:px-6">
            <Shot name="dashboard" alt={FEATURES[0]!.alt} priority />
          </div>
        </section>

        <section id="features" aria-labelledby="features-title" className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 id="features-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
                One place for the whole question
              </h2>
              <p className="mt-4 text-muted-foreground">
                From how your portfolio is doing, to what today&rsquo;s news means for it, to
                whether a new company would make it riskier.
              </p>
            </div>
            <div className="mt-16 space-y-24">
              {FEATURES.map((f, i) => (
                <article
                  key={f.id}
                  aria-labelledby={`${f.id}-title`}
                  className="grid items-center gap-10 lg:grid-cols-12"
                >
                  <div className={cn("lg:col-span-5", i % 2 === 1 && "lg:order-2")}>
                    <p className="flex items-center gap-2 text-sm font-medium text-primary">
                      <f.icon className="size-4" aria-hidden="true" />
                      {f.eyebrow}
                    </p>
                    <h3
                      id={`${f.id}-title`}
                      className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
                    >
                      {f.title}
                    </h3>
                    <p className="mt-4 text-muted-foreground">{f.body}</p>
                    <ul className="mt-6 space-y-2.5">
                      {f.points.map((p) => (
                        <li key={p} className="flex gap-2.5 text-sm">
                          <BadgeCheck
                            className="mt-0.5 size-4 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className={cn("lg:col-span-7", i % 2 === 1 && "lg:order-1")}>
                    <Shot name={f.shot} alt={f.alt} />
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="checked" aria-labelledby="checked-title" className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="max-w-2xl">
              <h2 id="checked-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
                How answers are checked
              </h2>
              <p className="mt-4 text-muted-foreground">
                A language model can write a confident number that is simply wrong. PortfolioLab
                does not let one through.
              </p>
            </div>
            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-2xl border bg-card p-6">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="tools-title" className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <h2 id="tools-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              And the analysis tools behind it
            </h2>
            <p className="mt-4 max-w-2xl text-muted-foreground">
              Every view the assistant uses is also a page you can open yourself.
            </p>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {TOOLS.map((t) => (
                <li key={t.name} className="rounded-2xl border bg-card p-5">
                  <t.icon className="size-5 text-primary" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{t.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="data" aria-labelledby="data-title" className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Database className="size-4" aria-hidden="true" />
              Data
            </div>
            <h2 id="data-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Where the numbers come from
            </h2>
            <dl className="mt-10 grid gap-6 sm:grid-cols-2">
              {SOURCES.map((s) => (
                <div key={s.name} className="border-l-2 border-primary/40 pl-4">
                  <dt className="font-semibold">{s.name}</dt>
                  <dd className="mt-1 text-sm text-muted-foreground">{s.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="border-t bg-muted/30">
          <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
            <h2 id="cta-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Start with an example portfolio
            </h2>
            <p className="mt-4 text-muted-foreground">
              The app opens with sample portfolios already loaded. Change them, import your own, or
              ask the assistant anything about an S&amp;P 500 company.
            </p>
            <div className="mt-8">
              <Link href="/dashboard" className={appLink}>
                Open the app <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <BrandMark className="size-5" />
            <span>PortfolioLab</span>
          </div>
          <p>
            Research, not investment advice. Figures are computed from historical data and do not
            predict future results.
          </p>
        </div>
      </footer>
    </div>
  );
}
