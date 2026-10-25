# Architecture

For developers. For the product story read `OVERVIEW.md`; for why things are the way they are read `DECISIONS.md`.

## The shape of the system

```
                   Yahoo prices   SEC EDGAR (8-K, 10-K)   news providers (optional)
                        |                 |                        |
                        v                 v                        v
                 packages/data  ---->  Postgres  <----  packages/classify (AI: news class, exposure drafts)
                                          |
                      packages/finance (pure math, no I/O)
                                          |
                    apps/web  server/*.ts  (services: load rows, call math, shape results)
                                          |
              API route handlers  <----  packages/explain (AI explanations, checked against the numbers)
                                          |
                                   React pages (apps/web/src/components)
```

Rules that keep it honest:

1. **All math lives in `packages/finance`.** Pure functions, no database, no network, no clock. Every function has tests with hand-computed expectations.
2. **Services in `apps/web/src/server` are thin.** They load rows, call the math, and shape a result. They never compute finance themselves.
3. **The language model is never the source of a number.** It explains, classifies or drafts; its output is validated before use.
4. **Everything user-owned is session-scoped.** An anonymous httpOnly cookie identifies a session; another session's portfolio returns 404.

## Packages

| Package              | Responsibility         | Key files                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/finance`   | Portfolio math         | `series`, `metrics`, `weights`, `correlation`, `exposure` (loadings, factor HHI), `attribution`, `relevance` (news score), `terminal` (VaR, drawdowns, risk shares), `benchmark` (beta, alpha, capture), `stress`, `discovery`, `eventstudy` (market model, CAR, spillover), `experiment` (randomization, power, permutation test), `optimize` (min-variance, risk parity), `simulation` (block bootstrap), `fundamentals` |
| `packages/data`      | Fetching and ingesting | `providers/` (Yahoo, Tiingo, fixture), `sec/` (EDGAR client, 8-K mapping, fundamentals), `news/` (Finnhub, Marketaux, clustering, market session), `matching/` (company alias matching), `ingest`, CLIs                                                                                                                                                                                                                    |
| `packages/classify`  | AI with validation     | `classifier` (news class and event type), `exposures` (draft exposure scores, agreement metrics), `eval` (accuracy harness), `store`                                                                                                                                                                                                                                                                                       |
| `packages/explain`   | AI explanations        | `grounding` (number and citation checker), `generator` (explanations), `assistant` (tool-calling loop), `facts`                                                                                                                                                                                                                                                                                                            |
| `packages/db`        | Schema and migrations  | `schema/*`, `migrations/`, `testing.ts` (creates throwaway test databases)                                                                                                                                                                                                                                                                                                                                                 |
| `packages/demo`      | Dataset builders       | `data.ts` (demo companies, factors, exposures, news), `seed`, `cli`, `real-cli`                                                                                                                                                                                                                                                                                                                                            |
| `packages/shared`    | Settings               | `env.ts` (validated environment)                                                                                                                                                                                                                                                                                                                                                                                           |
| `services/analytics` | Python FastAPI         | health check only so far; heavy statistics were kept in TypeScript for one runtime                                                                                                                                                                                                                                                                                                                                         |

## Database

Postgres 16 (Docker, port 54330). Four databases next to each other, never mixed:

| Database       | Contents                                    | Built by                                       |
| -------------- | ------------------------------------------- | ---------------------------------------------- |
| `portfoliolab` | development fixtures                        | `pnpm db:seed`                                 |
| `pl_demo`      | made-up, labelled demo data                 | `pnpm demo`                                    |
| `pl_real`      | real prices, SEC data, AI-drafted exposures | `pnpm real:seed`, `data:sec`, `data:exposures` |
| `pl_e2e`       | rebuilt on every end-to-end run             | `apps/web/e2e/setup-db.ts`                     |

Tables (grouped):

- **Market**: `companies` (with SEC `cik`), `prices_daily`, `benchmark_prices` (SPY), `data_sources`, `fundamentals` (annual SEC figures).
- **Exposure model**: `factors`, `factor_relationships`, `company_factor_exposures` (versioned with `valid_from`/`valid_to`, `source` of manual or AI, `reviewed_by`/`reviewed_at`).
- **News**: `news_articles`, `event_types`, `news_classifications`, `news_company_links`, `company_aliases`, `ingest_failures`, `llm_runs` (cache and audit log of every AI call).
- **Users**: `sessions`, `portfolios`, `holdings`, `rate_limit_hits` (Postgres-backed limiter with advisory locks).
- **Study**: `experiment_participants`, `experiment_responses`, `experiment_submissions`, `experiment_events`.

Migrations are generated with `pnpm db:generate` and applied by `pnpm db:migrate`.

## Web app

`apps/web/src`:

- `app/(app)/*` pages (Dashboard, Terminal, Exposures, Correlation, News, Reactions, Stress Lab, Discovery, Rebalance Lab, Simulation, Research, Guide, Review) with a shared layout: grouped sidebar, theme toggle, guided tour.
- `app/(study)/experiment` the research study, with its own minimal layout.
- `app/api/**/route.ts` the HTTP API (list below).
- `components/` UI by area (`portfolio`, `research`, `news`, `onboarding`, `review`, `study`, `charts`, `ui`).
- `server/` the services. `lib/` client helpers (API client with session handling, formatting, chart colors, onboarding state).
- `proxy.ts` keeps study participants inside the study.

Notable conventions:

- Pages that use the URL (`usePathname`) are wrapped in `<Suspense>` so dynamic routes still build.
- The API client creates the session once (single-flight) and retries a 401 once.
- Theme: a script in `<head>` applies the stored theme before paint; charts read CSS variables so they follow it.

### API routes

```
Session, data      POST /api/session   GET /api/health   GET /api/companies   GET|POST /api/samples
Import             POST /api/import/preview  (parse result to weights; no session needed)
Portfolios         GET|POST /api/portfolios   DELETE /api/portfolios/:id
Per portfolio      analytics  correlation  exposures  terminal  insights  radar  export
                   move  move/explain  explain  explain-tool  assistant
                   stress (GET catalog, POST run)  discovery  whatif  rebalance  simulation  benchmark
Research           GET /api/research/:ticker
Reactions          GET /api/events   GET /api/events/spillover
Review (token)     GET /api/review/summary|companies   GET|PUT /api/review/companies/:ticker
Study              /api/experiment, enroll, universe, preview, submit, events, participant,
                   export and results (admin token)
```

All handlers go through `route()` (`server/errors.ts`) which assigns a request id, logs, and maps errors to a stable JSON shape with codes `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `unavailable`, `internal`.

## The AI safety layer

- **Facts and grounding** (`packages/explain/grounding.ts`): output is checked so every digit-bearing number appears in a numbered fact, every `[F#]` citation exists, and buy/sell/hold directives are rejected.
- **One retry, then fallback**: a failing answer is retried once with the problems listed, then replaced by the facts themselves. Fallbacks are never cached.
- **Cache and limit**: grounded results are cached in `llm_runs`; a shared limit of 10 AI requests per session per hour is stored in Postgres.
- **Assistant** (`explain/assistant.ts`): a tool loop (max 4 rounds). Tool outputs become facts; an answer with no tool call is rejected.
- **Drafting exposures** (`classify/exposures.ts`): output is cleaned (known forces only, ranges, no duplicates, confidence capped at 0.8) and stored labelled "AI-drafted, not reviewed". Reviewed or existing profiles are never overwritten.
- **Model**: OpenAI Responses API, default `gpt-6-sol`, behind small interfaces so another provider is one class.

## Where to find a calculation

| Question                         | Where                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| How is concentration measured?   | `finance/exposure.ts` (factor HHI over normalized absolute net loadings; ADR 0004) |
| How is news scored?              | `finance/relevance.ts` (10 x exposure match x impact x recency)                    |
| What is an abnormal return?      | `finance/eventstudy.ts` (market model on days -250 to -30, no look-ahead)          |
| Spillover test                   | `finance/eventstudy.ts` `spilloverFigures`, `server/spillover.ts`                  |
| Stress impact                    | `finance/stress.ts` (linear, 3% per exposure point under a full shock)             |
| Lowest-volatility mix            | `finance/optimize.ts` (accelerated projected gradient on a capped simplex)         |
| Simulation                       | `finance/simulation.ts` (circular block bootstrap, optional re-centering)          |
| Study randomization and analysis | `finance/experiment.ts`, `server/experiment.ts`                                    |

## Testing

- **Unit** (Vitest): about 390 tests across packages. Database tests create and drop their own throwaway databases (`createTestDb`) and need `DATABASE_URL`.
- **Real-data checks** (`e2e:real`, Playwright): 16 read-only tests against `pl_real` (integrity of prices and filings, known facts, plausibility of every analysis on the sample portfolios, no NaN on any page). Writes nothing, never calls OpenAI.
- **End to end** (Playwright, real Chrome, desktop and phone): about 320 tests against a production build, a fresh `pl_e2e` database, and a mock OpenAI server (`e2e/mock-openai.ts`) with modes for grounded, ungrounded, retry, refusal, incomplete and error answers. Includes axe accessibility scans in light and dark, session isolation, independent recomputation of displayed numbers, and mutation checks.
- Tests that edit shared fixtures (the review tool) can only run once per seeded database; the full `e2e` script reseeds first.
- Gotchas: `getByRole("alert")` also matches Next's route announcer (use the `appAlert` helper); CSS transitions can make accessibility scans flaky (wait for animations first); Prettier reflows code, so scripted text edits must be verified.

## Adding a new analysis tool

1. Put the math in `packages/finance` with tests (hand-computed expectations and invariants).
2. Add a service in `apps/web/src/server` that loads data and calls it; add a route under `app/api/portfolios/[id]/`.
3. Add a view in `components/portfolio` using `WithPortfolio`, `PageHeader`, `HowToRead`, `Loading`.
4. Add the page and a nav entry in `components/layout/nav.tsx` (with a `data-tour` value if it belongs in the tour).
5. For an AI explanation, add a facts builder in `server/tool-explain.ts` and an `ExplainTool` button.
6. Add end-to-end tests (API contract, page, accessibility) and a section in `docs/DECISIONS.md` including mistakes.

## Environments and commands

| Command                                                                                     | Does                                       |
| ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `pnpm db:up`, `db:down`, `db:migrate`, `db:seed`, `db:generate`                             | database lifecycle                         |
| `pnpm data:sp500`, `data:ingest`, `data:news`, `data:aliases`, `data:sec`, `data:exposures` | data pipelines                             |
| `pnpm demo`, `demo:seed`                                                                    | made-up demo database and app              |
| `pnpm real:seed`, `real`                                                                    | real-data database and app                 |
| `pnpm format`, `lint`, `typecheck`, `test`                                                  | checks                                     |
| `pnpm --filter @portfolio-lab/web e2e`                                                      | browser tests (rebuilds and reseeds)       |
| `pnpm --filter @portfolio-lab/web e2e:real`                                                 | read-only checks on the real-data database |
