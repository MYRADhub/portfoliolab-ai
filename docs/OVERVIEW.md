# PortfolioLab AI: overview

## The problem

A portfolio of ten stocks can look diversified and still depend on one thing: interest rates, AI spending, a single supply chain. Standard tools show sectors, weights and correlations, which describe what happened. They rarely show _why_ holdings move together, so the concentration stays hidden until it hurts.

## What it does

| Area                   | What you get                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exposures              | Each holding is linked to the economic forces it depends on (interest rates, oil, China demand, AI capex and more). An interactive map and two numbers, effective sectors versus effective forces, show how concentrated a portfolio really is. |
| Dashboard and Terminal | Plain-language insight cards (what to watch, most important first) and a four-section workspace of charts and tables: returns, risk, drawdowns, correlation, news.                                                                              |
| News                   | Stories ranked by a transparent score: how much of your money they touch, how economically important they are, how fresh they are. A "why am I seeing this" breakdown shows each part.                                                          |
| Reactions              | A market-model event study on real earnings events: what a stock did around the news after removing what the market did.                                                                                                                        |
| Market comparison      | Beta, alpha, tracking error and up/down capture against the S&P 500, with rolling beta and year-by-year returns.                                                                                                                                |
| Stress Lab             | Push an economic force up or down, or pick a scenario, and see the estimated effect on each holding and the portfolio, with a reliability figure.                                                                                               |
| Rebalance Lab          | Compare your weights with equal weights, the lowest-volatility mix and equal-risk weights.                                                                                                                                                      |
| Simulation             | Thousands of possible paths built from the portfolio's own history, re-centred on a typical return so a past boom is not assumed to repeat.                                                                                                     |
| Discovery and Research | Candidates that would spread your exposures across more forces; company pages with fundamentals from SEC filings; an assistant that can only quote numbers its tools returned.                                                                  |
| Study                  | A pre-registered experiment module: does showing hidden exposures change how people diversify? Off by default.                                                                                                                                  |
| Onboarding             | A welcome card, a self-ticking checklist and an 8-step guided tour that spotlights the real interface.                                                                                                                                          |

## Principle: math first, words last

Every number comes from a pure, tested function. The language model only explains, classifies or narrates, and only inside guard rails:

- **Grounding.** An explanation is built from numbered facts. Every digit in the output must appear in a fact, every citation must exist, and buy/sell/hold directives are rejected. A bad answer gets one retry and is then replaced by the figures themselves. Ungrounded prose never reaches the user.
- **Tool-grounded assistant.** The assistant answers by calling tools (portfolio summary, exposures, company data, news, what-if, stress). It may only quote what the tools returned, and an answer given without any tool call is rejected.
- **No advice.** Results are research information. Pages say what they cannot show.

## Real data, no paid sources

- 503 S&P 500 companies, about 622,000 daily prices over five years (Yahoo Finance public endpoint).
- About 6,150 earnings events from SEC Form 8-K filings, timestamped to the second the SEC accepted them, mapped to event types by fixed rules; annual fundamentals from SEC 10-K filings.
- Hidden-exposure scores: 24 companies have hand-made illustrative profiles and the rest of the index has AI-drafted profiles over 12 forces. Both are labelled as unreviewed wherever they appear. On the 24 companies that have both, the AI drafts agree with the hand-made profiles (average cosine similarity 0.84, direction agreement 94%), but both are AI-written, so this shows consistency, not truth. Reviewed exposure data against company filings is the main open research task.

## A result worth showing

On about 6,150 real earnings events the average abnormal return over the first two days is close to zero (about +0.1%, t about 1.0), as expected when good and bad surprises cancel. The typical move in either direction is about 4.9%, and 55% of events move a stock by more than twice its normal daily noise. The largest reactions are real and recognisable, for example Centene in July 2025 (about -40%), which is a useful sign that dates, prices and the market model line up.

## Does the exposure map capture anything real?

A direct test on real data: when a large company reports earnings, do stocks with similar hidden exposures move the same way, more than dissimilar stocks do? Pooled over 121 earnings days for 11 bellwethers, the average correlation is +0.055 (t about 4.2), and +0.041 (t about 3.8, 95% range +0.020 to +0.062) after removing what sharing a sector explains. The effect is small, varies by company and is strongest among chip companies. Caveats: events are not fully independent and the exposure scores are AI drafts, so this is suggestive evidence that the map reflects real shared drivers, not proof. Details in `docs/DECISIONS.md` section 26.

## How it was checked

- About 390 unit tests, including hand-computed expectations (regressions, optimiser closed forms, relevance scores, concentration measures) and invariants (portfolio contributions sum to the portfolio return; the minimum-variance mix is never riskier than any feasible alternative; the event-study model never uses days after the event).
- About 320 end-to-end browser tests in desktop and phone layouts, plus 16 read-only checks against the real-data database. The browser tests include accessibility scans in light and dark themes, a mock language-model server (grounded, ungrounded, retry, refusal, error), session isolation, and independent recomputation of displayed numbers.
- Mutation checks: the suite fails when grounding or session ownership is deliberately broken.
- Bugs the tests and real data caught are listed honestly in `docs/DECISIONS.md` (section 13 and the "Mistakes" part of each slice), for example a simulation that reported a 0% chance of loss because it replayed a boom.

## Architecture

pnpm monorepo. `apps/web` (Next.js, TypeScript, Tailwind, Recharts), `packages/finance` (all math, no I/O), `packages/data` (price, SEC and news adapters), `packages/classify` and `packages/explain` (language-model layers with validation), `packages/db` (Postgres with Drizzle migrations), `packages/demo` (demo and real-data builders), `services/analytics` (Python, health only so far). Anonymous cookie sessions; every portfolio is private to its session.

## Limitations, stated plainly

- Yahoo's endpoint is unofficial and suitable for research only; a licensed source is needed for anything public.
- The market proxy for event studies is an equal-weighted average of other S&P 500 stocks, not an index series.
- Exposure scores are judgments with stated confidence, not measurements, and only 24 companies have them.
- Rebalance results are in-sample; simulations assume the future is as bumpy as the last three years.
- The research study has no ethics approval and must not be run on people until it does.

## Run it

See the setup in `README.md`: `pnpm demo` for a labelled made-up dataset, or `pnpm real:seed`, `pnpm data:sec` and `pnpm real` for real data.
