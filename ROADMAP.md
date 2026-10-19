# PortfolioLab AI - Technical Roadmap

Status: DRAFT for alignment. Items marked **[PROPOSED]** are my defaults and are not agreed. Items marked **[DECISION]** need an answer before the phase that depends on them. No code has been written.

Core thesis to protect (from description.md): every feature must serve **exposure -> event -> stock -> portfolio -> explanation**. If it does not, it is secondary.

Architectural rule that follows from the description: **math first, LLM last.** All numbers (weights, returns, exposures, correlations, abnormal returns, contributions) are computed deterministically and stored. The LLM only explains, classifies, and seeds data, and always receives structured inputs. It never produces a number the user sees as a fact without a computed source.

---

## Decisions log (2026-10-18)

| Decision             | Outcome                                         | Consequence                                                                                                                                                |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack split          | Next.js (TS) + Python FastAPI analytics service | Monorepo with `services/analytics` from Phase 1; shared contract via OpenAPI-generated TS client                                                           |
| Data budget          | Free tiers only                                 | Rate limits and shallow news history. Phase 6 backfill and Phase 15 event studies are at risk; see constraints below                                       |
| Universe             | S&P 500                                         | Exposure seeding must be LLM-first with spot audits; Phase 3 grows from 2 to about 4 weeks (gold set of 20-30 fully hand-reviewed, rest sampled at 15-20%) |
| Exposure scale       | Magnitude 0-3 plus direction -1/0/+1            | As modeled in section 3                                                                                                                                    |
| Concentration metric | Open                                            | Needed by Phase 4                                                                                                                                          |

Constraints created by the combination of choices (to revisit, not blockers for Phases 0-2):

1. **Free news tiers cannot support S&P 500 coverage plus a 1-2 year backfill.** Plan: ingest news only for portfolio-held and watchlisted tickers in V1, run the Phase 0 provider spike to measure real limits, and treat historical event studies (Phase 15) as needing either a paid tier or SEC 8-K filings (free, EDGAR, timestamped) as the event source. 8-K item types map cleanly to event types and are a strong free substitute.
2. **S&P 500 plus free price APIs:** 500 tickers x 5 years of daily bars is feasible on Tiingo/Alpha Vantage free tiers only via slow, staged backfill over several days. Budget for it in Phase 2.
3. **S&P 500 membership must be point-in-time** if used for event studies (survivorship bias). V1 uses current constituents and labels backtests accordingly.

---

## 0. Issues in the description to resolve before building

1. **Exposure scores are 0-3 but have no sign.** The oil example (XOM positive, DAL negative) and rates example need direction. Proposal: each exposure is `(magnitude 0-3, direction -1/0/+1 relative to factor increase)`. Equivalent to a signed score in [-3, +3]. Without this, Stress Lab and News Impact cannot work. **[DECISION]**
2. **"Hidden concentration" is undefined**, but it is the primary dependent variable in the research experiment. It must be defined mathematically before the experiment design (Phase 12). Candidates: HHI over portfolio-level factor loadings; effective number of independent bets from the factor covariance; max single-factor share of total exposure. Proposal: report all three, pre-register one as primary. **[DECISION]**
3. **Exposure scores are expert/LLM judgments, not measurements.** Users will read "VERY HIGH" as fact. We need provenance (source, rationale, confidence, version, reviewer) on every score, and a visible "how we got this" in the UI.
4. **Event-study claims need care.** News timing (after-close vs intraday), overlapping events, confounding earnings dates, and survivorship/look-ahead bias in the universe all corrupt "average reaction after similar events". Needs a proper abnormal-return method (market model or Fama-French), clustered events handling, and minimum sample size before showing a persistence prior.
5. **Reaction Persistence Score** conflates a prediction (before the fact) and a measurement (after). Split into: _expected persistence_ (prior from event class history + LLM judgment) and _realized persistence_ (measured at +2/+10/+30 days). Show both; never present the prior as a forecast without sample size and confidence interval.
6. **Compliance framing.** "Suggestions" must stay "research candidates", with a standing not-investment-advice disclaimer. News and price data licenses usually restrict redistribution/display; this constrains provider choice (Phase 0).
7. **Scope.** The description is a 12+ feature product. The roadmap below ships V1 as items 1-9 from the description's "code first" list and sequences the rest.

---

## 1. Proposed stack **[PROPOSED]**

| Layer             | Choice                                                                                                                                             | Why                                                                                                                | Alternative                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Web app           | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui                                                                                           | One language across UI/API, fast to ship, good charting ecosystem                                                  | Vite SPA + separate API                                  |
| Charts            | Recharts for standard charts; D3 (or visx) for exposure graph and correlation heatmap                                                              | Exposure graph is a node-link diagram, needs more than Recharts                                                    | ECharts                                                  |
| DB                | PostgreSQL (Neon or Supabase)                                                                                                                      | Relational model fits (factors, exposures, holdings); `pgvector` available if we later want semantic news matching | SQLite for local dev only                                |
| ORM/migrations    | Drizzle                                                                                                                                            | Type-safe, SQL-first, light                                                                                        | Prisma                                                   |
| Analytics service | Python (FastAPI) with pandas, numpy, statsmodels, scikit-learn                                                                                     | Event studies, covariance, regression are far easier and more trustworthy in Python                                | Do it all in TypeScript (simpler ops, weaker stats libs) |
| Job queue         | Postgres-backed queue (pg-boss) or Inngest                                                                                                         | Ingestion, classification, nightly recompute. Avoids Redis in V1                                                   | BullMQ + Redis                                           |
| LLM               | Anthropic API (Sonnet-class for classification/explanation; Haiku-class for high-volume relevance triage), structured outputs via tool/JSON schema | Strict schemas for classification; cost tiering                                                                    | -                                                        |
| Auth              | Auth.js or Supabase Auth; anonymous-portfolio mode first                                                                                           | Experiment needs participant IDs, not necessarily accounts                                                         | Clerk                                                    |
| Hosting           | Vercel (web) + Fly.io/Railway/Render (Python service + workers)                                                                                    | Cheap, simple                                                                                                      | Single VPS with Docker Compose                           |
| Monorepo          | pnpm workspaces: `apps/web`, `services/analytics`, `packages/db`, `packages/shared`                                                                | Shared types and schemas                                                                                           | Polyrepo                                                 |
| Testing           | Vitest + Playwright (web), pytest (analytics), golden-file tests for LLM prompts                                                                   | See section 5                                                                                                      | -                                                        |

Biggest stack question: **one language or two.** Python analytics service doubles ops surface but I would not do event studies and covariance estimation in TS. If the team is TS-only and stats stay simple in V1 (correlation, weights, volatility), we can defer the Python service to Phase 9+ and compute in TS first. **[DECISION]**

---

## 2. Data sources **[DECISION - budget dependent]**

| Need                               | Options                                                                           | Notes                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Daily prices + corporate actions   | Tiingo, Polygon, Alpha Vantage, FMP, Twelve Data. `yfinance` for prototyping only | yfinance is unofficial and ToS-grey; do not ship on it. Must use adjusted prices for returns                               |
| Fundamentals                       | FMP, SEC EDGAR (free, authoritative, more work)                                   | V1 needs only market cap, sector, industry, basic ratios                                                                   |
| News                               | Finnhub, Marketaux, Polygon news, NewsAPI, Benzinga (paid)                        | Check: full text vs headline+snippet, ticker tagging quality, publish timestamps (needed for event study), display license |
| Macro series (rates, oil, USD)     | FRED (free)                                                                       | Needed for factor-return validation and stress scenarios                                                                   |
| Benchmark returns / factor returns | Kenneth French data library (free)                                                | For abnormal-return models                                                                                                 |

Rule: all providers behind an interface (`PriceProvider`, `NewsProvider`) so we can swap. Cache raw responses; store normalized rows.

Universe for V1 **[DECISION]**: S&P 100 (about 100 names) is my recommendation. Exposure profiles are hand-reviewed, so universe size is the real constraint. 500 is feasible only if LLM-seeded and spot-audited.

---

## 3. Data model (draft)

```
companies(id, ticker, name, exchange, sector, industry, country, market_cap, active_from, active_to)
prices_daily(company_id, date, open, high, low, close, adj_close, volume)           -- PK (company_id, date)

factors(id, slug, name, category, description, unit_hint)
  category in: macro | commodity | geography | supply_chain | theme | regulation | demand
factor_relationships(src_factor_id, dst_factor_id, direction, strength, rationale)  -- second-order transmission (oil -> airline fuel cost)

company_factor_exposures(
  company_id, factor_id,
  magnitude smallint,         -- 0..3
  direction smallint,         -- -1 | 0 | +1  (effect on company when factor rises)
  confidence numeric,         -- 0..1
  rationale text,
  evidence_urls jsonb,        -- filings, transcripts
  source enum('manual','llm_seeded','llm_updated'),
  reviewed_by, reviewed_at,
  version int, valid_from, valid_to                                                -- exposures change over time; keep history
)

company_relations(company_id_a, company_id_b, type)                                -- supplier, customer, competitor

portfolios(id, owner_id, name, base_currency, created_at)
holdings(portfolio_id, company_id, weight, shares, cost_basis, as_of)
portfolio_snapshots(portfolio_id, date, value, return_1d, ...)                     -- materialized for speed

news_articles(id, provider, provider_id, url, title, snippet, body, published_at, ingested_at, source_name, dedupe_hash, cluster_id)
news_company_links(article_id, company_id, method enum('provider_tag','ner','llm','exposure'), score)
news_factor_links(article_id, factor_id, direction, score)
news_classifications(
  article_id, event_type_id,
  classification enum('fundamental','narrative','noise'),
  market_relevance, fundamental_importance, expected_persistence,  -- 0..10
  confidence, model, prompt_version, created_at)
event_types(id, slug, name, parent_id)                                              -- earnings_miss, export_restriction, ceo_personal, ...
event_studies(article_id|event_id, company_id, t0, abnormal_ret_d0, car_d1, car_d5, car_d10, car_d30, model, est_window)
event_type_stats(event_type_id, n, mean_d0, mean_d5, mean_d30, ci_low, ci_high)

scenarios(id, slug, name, description)
scenario_factor_shocks(scenario_id, factor_id, shock_value, unit)
llm_runs(id, purpose, model, prompt_version, input_hash, output_json, tokens_in, tokens_out, cost_usd, created_at)   -- audit + cache

experiments(id, name, protocol_version)
participants(id, experiment_id, arm, consent_at)
participant_events(participant_id, ts, type, payload)                               -- every portfolio edit and view logged
```

Key design choices:

- Exposures are **versioned and time-valid**; backtests must use the exposure profile known at the time.
- Every LLM call goes through `llm_runs` (cache by input hash, audit, cost tracking).
- Factor taxonomy is closed (15-30 slugs, reviewed). LLM can only pick from it; proposing new factors goes to a review queue.

---

## 4. Phased roadmap

Estimates assume a small team (2-4 students/devs, part time). Effort in ideal dev-days; adjust once team size is known.

### Phase 0 - Alignment and setup (3-5 days)

Goal: decisions made, repo bootstrapped, nothing user-facing.

- Resolve all **[DECISION]** items (stack, providers, universe, exposure sign, concentration metric).
- Repo: monorepo, TypeScript strict, ESLint/Prettier, commit hooks, CI (lint, typecheck, test) on every PR.
- Environments: local (Docker Compose: Postgres), staging, prod. `.env` schema validated at startup (zod). Secrets never in repo.
- Provider evaluation spike: pull 2 years of prices for 10 tickers and 1 week of news for 5 tickers from each candidate; compare coverage, timestamps, rate limits, license text.
- Write ADRs (short architecture decision records) for stack, providers, exposure scale, concentration metric.
- Disclaimer copy and data-attribution requirements captured.
  Exit criteria: CI green on empty app; ADRs merged; provider chosen with license reviewed.

### Phase 1 - Foundation (1 week)

Goal: skeleton app with DB, auth-lite, design system.

- Next.js app, Tailwind, shadcn/ui, layout shell (sidebar: Dashboard, Exposures, Research, News; placeholders for later modules).
- Drizzle schema + migrations for companies, prices, factors, exposures, portfolios, holdings. Seed script.
- Typed API layer (tRPC or route handlers + zod); shared types package.
- Error handling convention (typed errors, user-safe messages), structured logging (pino), request IDs.
- Anonymous session (cookie) so a portfolio can exist without signup; account upgrade later.
  Tests: migration up/down, seed idempotency, API contract tests.
  Exit: `pnpm dev` shows empty dashboard; DB migrates cleanly from zero.

### Phase 2 - Market data and portfolio creation (1.5 weeks) [description item 1, 2]

Progress (2026-10-19): done and tested - portfolio math (`packages/finance`), provider interface with retry and fixture provider, Tiingo adapter (mock-tested only), idempotent ingestion with staged `runUpdate` (stalest first, stops on rate limit), S&P 500 constituent load from a dated Wikipedia snapshot (503 tickers), portfolio and company APIs, portfolio form, dashboard. Remaining: verify Tiingo against live data and split handling (NVDA 2024, AAPL 2020), real 5-year backfill (needs API key), scheduled nightly job (needs deploy target), UI visual check. The constituent list is current membership, not point-in-time.

- Provider adapters: `PriceProvider` with rate limiting, retry/backoff, raw-response cache.
- Universe load (tickers, sector, industry, market cap). Backfill 5 years of adjusted daily prices. Nightly incremental update job; gap detection and alerting.
- Corporate-action handling: use adjusted close for returns; test around known splits (NVDA 2024, AAPL 2020).
- Portfolio creation UI: ticker autocomplete, weights (percent) or shares; validation (sum to 100, no duplicates, unknown tickers, weights normalize option, negative/short out of scope V1).
- Portfolio analytics (deterministic, unit-tested against hand-computed fixtures): value, daily return series, cumulative return, annualized volatility, max drawdown, Sharpe (risk-free from FRED, assumption displayed), sector allocation, top-weight concentration, HHI.
- Dashboard v1: KPI cards, equity curve, allocation donut, drawdown chart.
  Edge cases: IPO younger than lookback, delisted tickers, trading holidays, missing days, different history lengths (use common window and state it).
  Exit: user builds the 5-stock example and sees correct stats; numbers match a spreadsheet reference.

### Phase 3 - Factor taxonomy and exposure database (4 weeks with S&P 500) [item 3] - highest-risk data work

- Define the factor taxonomy (15-30): e.g. interest_rates, inflation, usd_strength, oil_price, consumer_spending, enterprise_it_spending, cloud_spending, ai_infrastructure_capex, semiconductor_demand, taiwan_supply_chain, china_demand, semiconductor_regulation, credit_cycle, housing, energy_transition, ... Reviewed by finance lead; each with a written definition and "what it means for the factor to rise".
- Exposure authoring workflow:
  1. LLM-seeded draft per company from structured inputs (business description, segment revenue, geographic revenue from 10-K, supplier/customer lists), output strict schema `{factor, magnitude, direction, rationale, evidence}`.
  2. Human review UI (admin): side-by-side draft vs. evidence, approve/edit/reject; track reviewer.
  3. Consistency checks: sector-level sanity (all oil producers positive on oil), magnitude distribution per company, no company with zero factors.
- Seed the V1 universe; hand-author and double-review a gold set of about 20 companies used later as the eval set for LLM seeding.
- Factor relationships (second order) table with a small curated set (about 30 edges) for the Impact Engine.
- Versioning: every change bumps `version`, old rows get `valid_to`.
  Exit: 100% of V1 universe has reviewed exposures; gold-set agreement between LLM seed and human at or above an agreed threshold (e.g. 80% within 1 magnitude point).

### Phase 4 - Hidden Exposure Engine (2 weeks) [item 4] - the centerpiece

Progress (2026-10-19): done and tested without real data - loadings, factor HHI per ADR 0004, pairwise overlap and shared/offsetting factors (`packages/finance/src/exposure.ts`), exposure service and API, exposures page (empty state until factors are seeded). Remaining: LOW/MEDIUM/HIGH/VERY HIGH bucketing (needs calibration on real exposure data), exposure tree per holding, factor drill-down, calculation-audit panel. Blocked on the taxonomy review (Phase 3).

- Portfolio factor vector: `E_p[f] = sum_i w_i * signed_exposure_i[f]`. Also report gross (abs) exposure and the per-holding contribution breakdown.
- Bucketing into LOW/MEDIUM/HIGH/VERY HIGH via documented, calibrated thresholds (calibrate on a set of reference portfolios, including an index-like diversified one, so a diversified portfolio does not read VERY HIGH everywhere).
- Hidden concentration metrics (as decided in Phase 0): HHI over factors, effective number of bets, top-factor share. Compare "sector view" vs "factor view" to show the gap (the product's core claim).
- Shared-risk detection: for each pair of holdings, factor overlap (cosine on signed exposure vectors) and the list of shared factors.
- UI: exposure heatmap (holdings x factors), portfolio factor bar chart, exposure tree per holding (as in the description), "shared risks" panel, click-through from a factor to the holdings driving it, rationale and confidence tooltips with evidence links.
- Explanation-of-calculation panel (auditability).
  Tests: property tests (scaling weights doesn't change normalized profile; a single-stock portfolio equals that company's profile; sign flips flip sign), golden portfolios.
  Exit: the NVDA/AAPL/MSFT/AMZN/JPM example reproduces the description's table qualitatively (AI, mega-cap tech, Taiwan, rates HIGH+).

### Phase 5 - Correlation analyzer (1 week) [item 5]

Progress (2026-10-19): done and tested - Pearson matrix, average pairwise, diversification ratio, correlation with portfolio, worst-days stress correlation, rolling correlation, clustered heatmap order, API and Correlation page (6m/1y/3y windows). Remaining: Ledoit-Wolf shrinkage covariance (planned for the Python service), rolling-correlation chart, and the correlation versus exposure-overlap scatter (needs exposure data).

- Return correlation matrix (daily log returns, configurable window 6m/1y/3y, Pearson plus Spearman optional); shrinkage covariance (Ledoit-Wolf) for stability.
- Rolling correlation, correlation to portfolio, average pairwise correlation, diversification ratio.
- Heatmap UI with sortable clustering (hierarchical).
- Product-critical view: **correlation vs. exposure overlap scatter** for every pair. Highlights "low correlation but shared vulnerability" pairs, the claim in section 14 of the description.
- Windows must align across holdings; show data window used. Correlations spike in stress; display the stress-period correlation alongside the full-sample one.
  Exit: matches pandas reference to 1e-6.

### Phase 6 - News ingestion (1.5 weeks) [item 6]

- `NewsProvider` adapter; scheduled pulls (every 5-15 min for portfolio tickers, hourly for the universe); backfill 1-2 years for event-study work (check provider limits).
- Normalization: UTC timestamps, source, canonical URL.
- Dedup: URL + normalized-title hash, then near-duplicate clustering (MinHash/SimHash or embedding similarity) into `cluster_id`; syndicated copies must collapse to one event.
- Store publish time AND ingest time; the market-hours flag (pre/regular/after-hours) is derived and stored; this determines event day `t0` later.
- Failure handling: provider outage, partial pages, rate limits, idempotent upserts, dead-letter table.
  Exit: 7 days of continuous ingestion for the universe with duplicate rate below an agreed target; ingestion dashboard (counts, lag, errors).

### Phase 7 - News to company matching (1.5 weeks) [item 7]

Layered matcher, cheapest first:

1. Provider ticker tags.
2. Alias/NER matching (company names, products, executives; maintain alias table).
3. Exposure-based matching: map article to factors (via LLM or keyword rules from `factors`), then to companies exposed to those factors (event -> factor -> company transmission using `factor_relationships`).
4. Relevance score per (article, company) and per (article, portfolio) = function of direct match, exposure weight in portfolio, and factor magnitude.

- Output `news_company_links` and `news_factor_links` with method and score so the UI can say _why_ it matched.
- Evaluate on a hand-labeled set (about 200 articles): precision/recall for direct matches; precision at top-k for the portfolio relevance ranking.
  Exit: for the example portfolio, "semiconductor export restrictions" ranks high and "European airline CEO" ranks near zero.

### Phase 8 - News classification: fundamental / narrative / noise (2 weeks) [item 8]

- Event type taxonomy (about 30-50 types) with definitions and examples; each type has a default class prior.
- LLM classifier with strict JSON schema: event_type, class, fundamental_importance 0-10, market_relevance 0-10, expected_persistence 0-10, mechanism (one sentence: how it changes revenue/cost/risk or why it does not), confidence. Prompt versioned; temperature 0; model recorded in `llm_runs`.
- Two-tier cost control: cheap model for relevance triage on all articles; stronger model only for articles above a relevance threshold.
- Eval harness: 300+ hand-labeled articles (including adversarial: CEO gossip true story, rumor, clickbait, press-release fluff); track accuracy, per-class F1, calibration of confidence; regression-run on every prompt/model change in CI (nightly if cost is a concern).
- Guardrails: classification stored with the article text hash, so reclassification is a new row, not an overwrite; "unknown/insufficient information" is an allowed output.
- Terminology in UI: "Temporary sentiment shock", never "fake news".
  Exit: macro F1 target agreed on the eval set (propose at or above 0.75 for the 3 classes) and no systematic failure on the adversarial slice.

### Phase 9 - AI explanation layer (1.5 weeks) [item 9]

- Context builder: assembles a typed, size-bounded JSON of portfolio, exposures, relevant events and their classification, computed metrics. This is the only thing the LLM sees.
- Explanation prompts per surface: portfolio summary, exposure explanation ("why am I vulnerable to rates"), single-article impact.
- Grounding rules: every numeric claim must come from the context; post-validate (regex/parse numbers in output and verify each exists in context; if not, regenerate or strip). Citations to the underlying record IDs rendered as links.
- Streaming responses, cache by input hash, per-user rate limits, token and cost budgets, graceful degradation when the LLM is down (show deterministic panels without prose).
- Safety: no buy/sell directives, disclaimer injected, refusals for out-of-scope questions.
  Exit: **V1 complete.** Demo flow: create portfolio -> see hidden exposures -> see ranked relevant news with classification -> read grounded explanation.

---

### V1.5 and beyond (sequenced as in the description)

**Phase 10 - Why Did My Portfolio Move? (1.5 wk)**
Return attribution (weight x return, contribution in percentage points), grouping by factor cluster, link top contributors to events from Phase 7-8 in the same window, LLM narrates computed shares. Key rule: attribution math is deterministic; the "70% from semis/AI" is computed by factor-cluster grouping, not by the LLM. Handle: intraday vs close-to-close, weight drift during the day, cash.

**Phase 11 - Market Radar (1 wk)**
Ranked feed per portfolio using relevance score, severity, recency decay; filters (class, factor, holding); "why am I seeing this"; daily digest; the low-relevance items collapsed, not hidden.

**Phase 12 - Stress Lab (2 wk)**
Scenario library (rates +2%, oil +50%, AI capex down, China demand down, Taiwan disruption) as `scenario_factor_shocks`. V1 method: linear `shock * signed_exposure * beta_scale` with per-factor sensitivity calibrated from history (regress holding returns on factor proxies: DGS10 changes, WTI returns, DXY, SOX, etc.) so "magnitude 2" maps to an estimated percent impact rather than an arbitrary number. Show a range, not a point. Custom scenario builder (choose factors and shocks). Second-order propagation via `factor_relationships` with damping. Clearly label as scenario analysis, not prediction.

**Phase 13 - Research Terminal and Assistant (2.5 wk)**
Search routing (ticker -> company research page; question -> assistant). Company page: fundamentals, recent news classified, exposures, price behavior, related companies (from `company_relations` and exposure similarity), portfolio consequences ("what if I add this": delta in factor profile, concentration, correlation). Assistant: tool-calling LLM over internal tools (`get_portfolio_exposures`, `get_news`, `compute_contribution`, `whatif_add_holding`, `stress`), so answers come from computed tools, not free recall. Conversation storage, citations, rate limits.

**Phase 14 - Discovery (1 wk)**
Optimizer-lite: rank candidates by reduction in hidden concentration metric when added at k% weight, subject to sector/market-cap filters; "positively exposed to falling rates / rising oil" queries via the exposure table. Output labeled "research candidates" with the factor deltas shown.

**Phase 15 - Event-study engine and reaction analyzer (3 wk)**
Python service. Abnormal return = actual - market-model prediction (estimation window e.g. [-250,-30], benchmark SPY or Fama-French). Compute CAR at d0/d1/d5/d10/d30. Event-day alignment using the market-hours flag. Handle clustering (drop or flag windows overlapping earnings), minimum n per event type, bootstrap confidence intervals. Populate `event_type_stats`. Feed the persistence prior back into Phase 8 outputs; show "realized persistence" after the fact. Cross-stock impact: detect abnormal-return clusters across the universe on an event day and test consistency with the exposure graph (do exposed stocks have significantly different abnormal returns than non-exposed? simple t-test / permutation).

**Phase 16 - Research experiment module (2-3 wk, design starts earlier)**

- Design (start in parallel around Phase 4): hypothesis, primary outcome (hidden concentration metric as pre-registered), sample size/power estimate, task design (construct or reconstruct a portfolio from a fixed universe and brief), randomization, control-arm UI (stocks, sectors, weights, volatility, correlations only) vs treatment-arm UI (adds exposure panels).
- Ethics: consent screen, data-use statement, IRB or school-equivalent approval, no real-money advice, anonymous IDs.
- Engineering: feature flag per arm, server-side randomization (stratified by experience), the control arm must be technically unable to load exposure endpoints, event logging (every edit, view, dwell time), export pipeline (CSV) and analysis notebooks, pre/post questionnaire (confidence, perceived diversification).
- Confound controls: same data window, same loading speed, same layout where possible.

---

## 5. Cross-cutting engineering

**Testing**

- Unit: all finance math against hand-computed/pandas fixtures (tolerance 1e-6). Property tests for exposure aggregation.
- Integration: provider adapters against recorded fixtures (VCR-style); DB with testcontainers.
- E2E (Playwright): create portfolio -> dashboard -> exposures.
- LLM: eval sets in repo (`/evals`), run in CI on prompt change; snapshot test on schema validity; fallback when output invalid (retry once, then degrade).
- Data quality: nightly checks (stale prices, missing days, ticker changes, null exposures, news lag).

**Observability and cost**

- Structured logs, error tracking (Sentry), job dashboards. Per-feature LLM cost report from `llm_runs`; hard monthly budget alarm.

**Security and privacy**

- Portfolio data is sensitive: row-level ownership checks, zod validation on every input, rate limiting, secrets in a manager, prompt-injection hygiene (article text is untrusted; delimited, schema-constrained outputs, no tool access from classification prompts).

**Performance**

- Precompute portfolio snapshots and correlation matrices nightly; cache exposure aggregation (it is a small matrix product); paginate news.

**Accessibility/UX**

- Color is never the only signal (the description's red/green dots need labels/icons); keyboard nav; no emoji in UI copy per project style.

**Documentation**

- `README`, ADRs, factor taxonomy doc, data dictionary, methodology page in-app ("How PortfolioLab computes exposures") - important for the research credibility.

---

## 6. Risks

| Risk                                     | Impact                           | Mitigation                                                                   |
| ---------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Exposure scores are subjective and wrong | Core value prop undermined       | Provenance, human review, gold set, confidence display, user feedback button |
| News API cost/licensing                  | Blocks Phase 6 and 15            | Provider spike in Phase 0; headline+snippet only if needed                   |
| LLM hallucinated numbers in explanations | Trust                            | Grounding validator, structured context                                      |
| Event-study conclusions on small n       | Misleading "historical evidence" | Min-n threshold, CIs, hide otherwise                                         |
| Scope creep                              | Never ships V1                   | V1 = Phases 0-9 only; everything else behind feature flags                   |
| LLM cost explosion                       | Budget                           | Two-tier models, caching, relevance gate                                     |
| Look-ahead bias in backtests             | Invalid research                 | Versioned exposures, point-in-time universe                                  |
| Regulatory perception as advice          | Legal                            | Wording, disclaimers, "research candidates"                                  |

---

## 7. Timeline (indicative, small team)

| Phase                     | Weeks (cumulative) |
| ------------------------- | ------------------ |
| 0 Alignment/setup         | 1                  |
| 1 Foundation              | 2                  |
| 2 Market data + portfolio | 3.5                |
| 3 Exposure DB             | 5.5                |
| 4 Hidden Exposure Engine  | 7.5                |
| 5 Correlation             | 8.5                |
| 6-7 News + matching       | 11.5               |
| 8 Classification          | 13.5               |
| 9 AI explanation = **V1** | 15                 |
| 10-14                     | about 23           |
| 15-16                     | about 29           |

Parallel tracks that shorten this: Phase 3 data authoring can start during Phase 1-2 (it is mostly non-code); experiment design (Phase 16) can start during Phase 4.

---

## 8. Immediate next steps (once decisions are made)

1. Answer the **[DECISION]** items (stack, data budget, universe, exposure sign, concentration metric).
2. Scaffold monorepo, CI, DB, and migrations (Phase 1).
3. Start the factor taxonomy document in parallel (non-code, finance lead).
4. Run the provider spike.
