# Decision log (plain language)

This page explains the choices made while building PortfolioLab, in everyday words. For each choice you get what was decided, why, what it costs, who made the call, and where it lives in the code. The short technical versions are in `docs/adr/`.

How to read the "Who" line:

- **You** means Murad made the call (an answer to a question, or an instruction).
- **Me** means Claude made the call and Murad can overrule it. These are the ones worth a second look.
- **Together** means Claude proposed and Murad agreed.

Status words: **Final** (settled), **Revisit** (a stop-gap that should be reconsidered), **Open** (not decided yet).

---

## 1. What we are building and in what order

**1.1 Build the "centerpiece" first, not everything at once.** Final. Who: Together.
The description lists a dozen features. We build version 1 as the first nine items from the description's own "what I would actually code first" list: portfolio creation, stock data, company exposure data, the hidden-exposure engine, correlation, news retrieval, matching news to companies, classifying news, and AI explanations. Everything else (Market Radar, Stress Lab, discovery, the research experiment) comes after.
Why: a smaller thing that works end to end teaches more than a big thing that half works.

**1.2 Math first, AI last.** Final. Who: the description, applied by me.
Every number a user sees (returns, weights, correlations, exposures) is computed by ordinary code and stored. The AI is only allowed to explain those numbers in words, to classify news, or to help draft data. It never creates a number on its own.
Why: a made-up number in a finance tool destroys trust. This rule is what the whole design leans on.

**1.3 Research, not advice.** Final. Who: Me (follows the description's own framing).
The app says "research candidates" and never "you should buy". The AI explanation is also blocked from telling anyone to buy, sell or hold, and every explanation carries a disclaimer.
Why: legal and ethical safety, and it keeps the tool honest about what it knows.

---

## 2. Technology choices

**2.1 One web app in TypeScript plus a separate Python service for heavy statistics.** Final. Who: You (you picked this option).
The Python service exists and answers a health check, but nothing heavy runs there yet. Ordinary portfolio math lives in TypeScript for speed and simplicity.
Cost: two things to deploy. Benefit: later statistics work (event studies, shrinkage covariance) is far easier in Python.

**2.2 Plain API routes with schema checks, not a heavier API framework.** Final. Who: Me.
Why: fewer moving parts. If you prefer the other approach it can be changed later.

**2.3 PostgreSQL database.** Final. Who: Me, accepted by you.
It runs in Docker on port 54330 because ports 5432 to 5434 were already used by your other projects. I did not touch those.

**2.4 One repository containing several packages.** Final. Who: Me.
The web app, database, finance math, data loading, news matching, classifier and explainer are separate packages so each can be tested alone.

**2.5 The AI provider is OpenAI, model `gpt-6-sol`.** Final. Who: You.
You said the model should be OpenAI and told me to take the key from your logistics project. I copied it into this project's private `.env` file (which git ignores) and never printed it. I reused the model your other project already uses.
The AI part is hidden behind a small interface, so swapping providers later is a contained change.

---

## 3. Data choices

**3.1 The stock universe is the S&P 500.** Final. Who: You.
Cost: someone has to review about 500 companies' risk profiles, so we plan to have the AI draft them and humans check a sample.

**3.2 The list of companies is today's membership, copied from Wikipedia and saved as a dated file.** Final for now. Who: Me.
Why: it is free and reproducible. **Limit:** companies that left the index years ago are missing, so any historical test would flatter the past ("survivorship bias"). The roadmap flags this.

**3.3 Free data tiers only.** Final. Who: You.
Consequence: slow price downloads, thin news history. We built the downloaders to resume where they stopped and to stop politely when a service says "slow down".

**3.4 A fake price generator for development.** Final. Who: Me.
Real price services need keys you have not provided yet, so development and tests use made-up but repeatable prices. **Every number you see in the running app today comes from this fake data**, including the AI explanations. They look real but mean nothing financially.

**3.5 Data providers are plug-in parts.** Final. Who: Me.
Tiingo (prices), Finnhub and Marketaux (news) have adapters written from their public documentation and tested against pretend responses. **They have never talked to the real services**, so expect small fixes when the keys arrive.

**3.6 Risk-free rate is 0% for now.** Revisit. Who: Me.
It affects the Sharpe ratio. The screen says so. Real rates come from FRED once a key exists.

---

## 4. The finance math

**4.1 Portfolios keep their target weights every day ("rebalanced daily").** Final. Who: Me.
Simple and standard, and it makes the contribution math add up exactly. Cost: a real investor who never rebalances sees weights drift, so their results differ slightly. The screen states the assumption.

**4.2 Only days when every holding has a price are used.** Final. Who: Me.
If one stock only has 6 months of history, the portfolio is analysed over those 6 months, and the screen says which holding limited it. If fewer than 30 shared days exist, the app refuses and explains why rather than showing a shaky number.

**4.3 Yearly figures use 252 trading days.** Final. Who: Me. Standard convention.

**4.4 Correlation uses daily returns and the ordinary (Pearson) formula, over 6 months, 1 year or 3 years.** Final. Who: Me.
We also show the average correlation on the portfolio's worst 10% of days, because stocks tend to move together when things go badly. It needs at least 20 such days, otherwise the card says "needs a longer window".
Deferred: a more robust "shrinkage" correlation estimate (planned for the Python service).

---

## 5. The "hidden exposure" idea

**5.1 Each company gets an exposure score from 0 to 3 plus a direction (helped, hurt, or neutral).** Final. Who: You (you chose to add direction).
Why: without direction we could not say that rising oil helps an oil company and hurts an airline. Every score also records a confidence, a reason, a source and a version, so it can be audited and changed over time.

**5.2 "Hidden concentration" is measured with a number called factor HHI.** Final. Who: You (you chose this option).
How, in words: add up each factor across the portfolio (weighted by position size), treat the size of each total as a share of all exposure, square the shares and add them. A portfolio spread evenly over many forces scores low; one dominated by a single force scores near 1. We also show its inverse, "effective number of factors", which is easier to picture.
Known limit: exposures in opposite directions on the same factor cancel out, which is intended for risk but can hide gross dependence.

**5.3 We never show a partial exposure analysis.** Final. Who: Me.
If even one holding has no exposure data, the page lists the missing tickers and stops. Showing a result for the rest would understate the risk.

**5.4 No invented exposure data.** Final. Who: Me.
The factor table is empty on purpose. The two draft lists in `docs/` (31 economic factors, 31 news event types) are waiting for your review. In tests and screenshots I used clearly labelled fake rows and deleted them afterwards.

**5.5 Risk labels like LOW / HIGH / VERY HIGH are not built yet.** Open. Who: Me.
They need to be calibrated against real exposure data, otherwise a diversified portfolio could look "very high" everywhere.

---

## 6. News: finding it, tidying it, linking it to companies

**6.1 Duplicate news is merged into groups.** Final. Who: Me.
Two articles belong together if their cleaned-up titles are at least 80% alike and they were published within 2 days. A repeat of the same headline 10 days later counts as a new event.

**6.2 Every article is stamped with the market session it appeared in.** Final. Who: Me.
Pre-market, regular hours, after hours, or closed (US Eastern time, daylight saving handled). From that we work out the first trading day whose price could reflect the news. Weekend news rolls to Monday. A holiday-aware version uses days that actually have price data.

**6.3 Linking news to companies in layers, cheapest first.** Final. Who: Me.
Layer 1: the news provider's own tags. Layer 2: spotting company names and ticker forms in the text. Layer 3 (through economic factors) and layer 4 (relevance to a specific portfolio) are not built.

**6.4 Name matching rules.** Final. Who: Me.

- A clear name ("Nvidia") scores 0.8, a multi-word name 0.9, a ticker form like `$TSLA` or `(NYSE: DIS)` 0.95.
- Names that are also ordinary words (Target, Fox, Visa, Dow and 14 others) score only 0.3 on their own, below the 0.5 cutoff.
- Several independent clues reinforce each other but never reach certainty (capped at 0.99).
- A mention in the headline counts fully, in the summary 90%, buried in the body 70%.
- Bare tickers like "IT" or "ON" are ignored because they are also everyday words.
  Known limit: "the Amazon river" still links to Amazon. A name matcher cannot tell geography from a company. This is recorded in a test.

**6.5 The list of "ambiguous" names is my judgment.** Revisit. Who: Me.
It is a short list in `packages/data/src/matching/alias.ts` and easy to extend when mistakes show up.

---

## 7. Classifying news (real change versus noise)

**7.1 Three classes plus "unclear".** Final. Who: Me, from the description.
Fundamental (changes the economics), narrative (shifts expectations), noise (attention only). "Unclear" is allowed so the AI is not forced to guess. A true story can still be noise, for example celebrity gossip about a CEO.

**7.2 Three 0-to-10 scores and a one-sentence reason.** Final. Who: Me.
How much it changes long-run economics, how likely it is to move the price soon, and how long the effect should last, plus the stated mechanism and a confidence.
Later, "how long it lasts" is meant to be replaced by what history actually shows (the event-study work).

**7.3 Defences against tricky text.** Final. Who: Me.
Article text is wrapped in tags and the AI is told it is data, not instructions. Any tag-like text inside an article is neutralised. Over-long articles are rejected instead of silently cut.

**7.4 Every AI call is logged and cached.** Final. Who: Me.
Same article, same model and same prompt version means no second call and no second bill. A new model or prompt creates a new row; old classifications are never overwritten, so changes can be compared.

**7.5 No automatic fallback model for refusals.** Open. Who: Me.
Refusals and failures are recorded as such. Adding a fallback is possible if you want it.

**7.6 The practice set is invented.** Final. Who: Me.
The 25 example headlines use fictional companies. The first live run got every class right and 88% of event types, which proves the pipeline works but says nothing about real accuracy. Real accuracy needs a set of real articles you label.

---

## 8. AI explanations

**8.1 The AI only sees a numbered list of facts.** Final. Who: Me.
Each fact is a label and a ready-made value ("Total return: +30.7%"). The AI must cite fact numbers like [F6].

**8.2 Every number in the answer is checked against the facts.** Final. Who: Me.
Any digit that is not in a fact's label or value rejects the answer. The AI gets one retry with the problems listed. If it still fails, the user sees only the figures and a notice. Made-up prose never reaches the screen, and failures are never saved for reuse.
This was tested against a live model: the first attempt failed because of a "1" from "(1 year)", which taught us that numbers in labels must count as grounded.

**8.3 Banned wording.** Final. Who: Me.
Phrases like "you should sell" or "consider reducing" are rejected. A test caught that "reducing" slipped past my first version.

**8.4 Limits.** Final. Who: Me.
10 new explanations per person per hour. Repeats of an identical portfolio are served from a saved copy and are free. The counter lives in the database so it works with several servers.
Trade-off: facts use one decimal place, so two portfolios that round to identical facts share a saved explanation, which is correct because the explanation would be identical.

---

## 9. Accounts, sessions and safety

**9.1 No sign-up yet. Each visitor gets an anonymous session.** Final. Who: Me.
A random ID in a cookie owns the portfolios. If you clear cookies you lose them. Real accounts come later.

**9.2 Cookie rules.** Final. Who: Me.
Not readable by scripts, not sent on cross-site posts, marked secure only when the connection is actually https (an earlier version used the build mode, which would have broken a plain-http deployment).

**9.3 Other people's portfolios look like they do not exist.** Final. Who: Me.
You get "not found" rather than "forbidden", so the app does not confirm that an ID exists.

**9.4 Lost cookie recovery.** Final. Who: Me.
If a request fails because the cookie is missing, the app quietly creates a session and retries once. This fixed a real race where a fast submit failed with a confusing message.

**9.5 Portfolios can be deleted, with a two-click confirmation.** Final. Who: Me.
This was missing until the end-to-end work exposed it.

---

## 10. Look and feel

**10.1 Color is never the only signal.** Final. Who: Me.
Heatmap cells always print their number. Charts and cards are labelled.

**10.2 Phones.** Final. Who: Me.
The sidebar becomes a top bar, wide tables wrap or scroll inside their cards, and one table drops a column on small screens. I found three layout faults by looking at screenshots that the automatic checks missed.

**10.3 Dark mode is not supported.** Final for now. Who: Me.
The styles exist but nothing switches them on.

---

## 11. How it is tested

**11.1 Two kinds of tests.** Final. Who: Me.
Fast unit tests for math and logic, and a browser suite that drives the real built app: 98 tests on desktop and phone-size Chrome.

**11.2 Tests never call the real OpenAI service.** Final. Who: Me.
A small fake server stands in, so results are repeatable and free. It can be switched to behave badly (made-up numbers, refusals, errors) to test the safety net.

**11.3 Tests use their own database.** Final. Who: Me.
It is rebuilt from scratch every run, so tests cannot be affected by leftovers.

**11.4 Tests were themselves tested.** Final. Who: Me.
I broke the grounding check and the ownership check on purpose and confirmed the suite fails. I also proved the accessibility scanner can fail by feeding it a bad page.

---

## 12. Things still open and who needs to act

| Open item                                                                                    | Who      | Why it matters                                             |
| -------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| Review the factor list (`docs/factor-taxonomy.md`) and event list (`docs/event-taxonomy.md`) | You      | Real exposure data and good classifications depend on them |
| API keys for Tiingo, Finnhub or Marketaux, FRED                                              | You      | Real prices and news; replaces fake data                   |
| Label about 200 real articles                                                                | You      | The only honest accuracy measurement                       |
| Formula for "how relevant is this news to my portfolio"                                      | Together | Needed for the Market Radar                                |
| Whether to add a fallback model when the AI refuses                                          | You      | Small robustness gain, more cost                           |
| Where to host the app                                                                        | You      | Decides database, secrets and the Python service           |

---

## 14. "Why did my portfolio move?" (added 2026-10-20)

**14.1 A holding's contribution is its weight times its return that day.** Final. Who: Me.
Example: a 25% holding that rises 1.55% adds 0.39 percentage points to the portfolio. Because we assume constant target weights (4.1), the contributions of all holdings add up exactly to the portfolio's return, and a test checks that to 12 decimal places. It also matches the growth curve on the dashboard.

**14.2 The user can pick any of the last 30 trading days; the default is the latest.** Final. Who: Me.
The first day of the data is not allowed because it has no previous day to compare with. Other dates (weekends, the future, nonsense) are refused with a clear message.

**14.3 Sectors are the grouping for now.** Final for now. Who: Me.
Holdings are grouped by their sector, because the economic-factor data does not exist yet. Once exposures are loaded, grouping by factor ("AI spending", "Taiwan supply chain") is the natural upgrade and is what the description really wants.

**14.4 "Share of the move" is a sector's contribution divided by the total move.** Final. Who: Me.
It can be above 100% or negative when sectors move in opposite directions (for example technology down 2.6 points while financials are up 0.1 means technology explains 104% of a 2.5 point fall). Shares always add to 100%. We do not show shares at all when the total move is under 0.05% because dividing by a tiny number is misleading.

**14.5 The headline sentence is written by ordinary code, not the AI.** Final. Who: Me.
Three wordings: "About 70% of the day's decline came from Technology holdings" when one sector explains between half and all of the move; "Technology holdings were the biggest drag ... partly offset by moves in other sectors" when it explains more than all of it; and "spread across sectors" otherwise.
I changed this after looking at a screenshot that said "About 133% of the day's decline" which a non-expert would find nonsensical. There is also a one-line note under the sector table explaining the over-100% case.

**14.6 News shown on a day is news that first reaches the market that day.** Final. Who: Me.
A Friday evening article counts for Monday. The same story syndicated by several outlets appears once, with "1 similar" noted. Only company links scoring at least 0.5 count, so ambiguous names like "Target" do not pull in unrelated stories. Ranking: most economically important first (from the classifier), then strongest company link, then newest. At most 10 are shown.

**14.7 We say news "may coincide with, not cause" a move.** Final. Who: Me.
The description itself warns against claiming causation. This sentence appears under the news list, and the AI is told in its instructions never to claim news caused the move.

**14.8 The AI narration of a move is optional and uses the same safety net.** Final. Who: Me.
A button, "Explain this move", sends only numbered facts (the day, the return, the top contributors, the sectors, up to 3 news titles, and a caution line). Every number is checked against the facts, exactly as for the portfolio explanation, including the retry and the figures-only fallback.
It shares the same limit of 10 AI explanations per hour per visitor, and a different day is a different saved explanation.

**14.9 News headlines count as facts the AI may quote.** Final. Who: Me.
Numbers inside a headline (for example "cuts outlook 12%") are allowed in the explanation because the headline is shown to the reader as a fact. This is a small loosening of the grounding rule and I think it is right, but it is worth knowing about.

**14.10 What is still missing for this feature.** Open. Who: Together.
No grouping by economic factor yet (needs exposure data). No check of whether other stocks moved abnormally the same day (that is the later event-study work). News in the development database is fixture data.

### Mistakes in this slice

- My first draft of the headline logic produced "About 133%", found only by looking at a screenshot. The check that the numbers added up could not catch a sentence that was technically right but confusing.
- A broad find-and-replace in a test file changed an unrelated expected count; the failing test showed it and I restored it.
- A command that works on Linux (`sed -i`) failed silently on macOS, so one fix did not apply the first time.

---

## 15. The News page and its relevance score (added 2026-10-20)

This answers the open question "how relevant is this news to my portfolio?". You had not chosen a formula, so I proposed one that a non-expert can read, and put every part of it on screen.

**15.1 Relevance is a 0 to 10 score built from three simple parts multiplied together.** Final for now. Who: Me. Revisit once real data exists.
Score = 10 x holdings touched x economic impact x freshness.

- **Holdings touched** (0 to 100%): how strongly the article is about things you own. Each matched holding contributes how sure we are the article is about that company, times a size factor, and several holdings reinforce each other without ever reaching certainty.
- **Economic impact** (0 to 100%): from the classifier. It is the "importance" score, but each type has a ceiling: real economic news can reach 100%, narrative news 60%, "unclear" 30%, and noise 20%. Why: so a gossip story the model rated "importance 9" can never outrank a genuine earnings change.
- **Freshness**: halves every 3 days, so a story from 6 days ago keeps a quarter of its weight.

**15.2 Position size matters, but small holdings still count.** Final for now. Who: Me.
A holding of 25% or more counts fully; a 2% holding counts about 45%; nothing counts for less than 40%. Why: a story about a tiny holding matters less to you, but you may still want to see it. The 25% and 40% are my guesses.

**15.3 Unclassified news gets a neutral impact of 50%.** Final for now. Who: Me.
It can never reach the top of the list (the best possible score is 5), but it is not buried either. Why: classification runs after ingestion, so new items briefly have no label.

**15.4 Low-scoring items are collapsed, not hidden.** Final. Who: Me, following the roadmap.
Anything under 1.0 sits in a "low-relevance items" fold with a count. The description's idea is "less, but more relevant" news, but silently dropping items would hide mistakes in the scoring.

**15.5 Every item can explain itself.** Final. Who: Me.
"Why am I seeing this?" shows each part, the numbers behind it (for example "90% sure it is about them, 25% of your portfolio"), the classifier's one-sentence reason, and the final arithmetic. The browser tests recompute every score from these parts independently.

**15.6 What counts as "news for this portfolio".** Final. Who: Me.
Only articles linked to a holding with a link score of at least 0.5 (so ambiguous names like "Target" do not pull in unrelated stories). Syndicated copies appear once. The default window is the last 7 days; you can choose 1, 3, 7, 14 or 30.

**15.7 Filters: by type and by holding.** Final. Who: Me.
Type includes "Not yet classified". When a filter matches nothing the page says so and offers "Clear filters", rather than showing the empty-portfolio message.

**15.8 Not built: scoring through economic factors (layer 3).** Open. Who: Together.
The description also wants news that affects you indirectly (for example an oil shock affecting an airline you hold even though the article never names it). That needs the factor data. Today only direct company mentions count.

**15.9 The portfolio "Delete" button shows on every page that selects a portfolio, including News.** Revisit. Who: Me.
It is guarded by a confirmation but it is out of place on a news page; moving it to a settings spot would be cleaner.

**15.10 The radar needs no price history.** Final. Who: Me.
Unlike the dashboard, it only needs your holdings and weights, so a brand-new stock with no prices still shows news.

### Mistakes in this slice

- My first expected ranking in a test was wrong (I put a 6-day-old unclassified item above a 1-day-old gossip item). The code was right, and the test arithmetic was mine.
- Cached explanations were shared across tests whose facts rounded the same, causing a flaky run. I replaced the "unique weights" trick with a counter shared across the whole run.
- Seeding recent news broke two older tests that assumed the latest day had none; I added a fixed "quiet day" for them.

---

## 16. Samples, the Terminal, the Guide and the demo database (added 2026-10-20)

You asked for mock portfolios to review, a more powerful dashboard in the style of a Bloomberg terminal, and a tutorial. This is how I read that and what I chose.

**16.1 Five sample portfolios, loaded with one click into your own session.** Final. Who: Me.
Each teaches one idea: Mega-cap tech (looks diversified, is not), Balanced across sectors, AI boom bet (one force drives everything), Defensive staples (calmer ride), Energy and banks (different forces). Loading never creates duplicates (matched by name), and one visitor's samples are never visible to another. Why a button and not pre-created data: portfolios belong to a browser cookie, so I cannot create them "for you" ahead of time.

**16.2 The demo runs on its own database, `pl_demo`.** Final. Who: Me.
Why: your dev database stays clean, and demo data can never be mistaken for real data. `pnpm demo` rebuilds it and starts the app. The app shows a banner saying everything is made up whenever demo mode is on.

**16.3 The demo exposures are my own illustrative guesses.** Revisit. Who: Me.
I wrote 79 exposure scores for 24 companies (for example "NVIDIA depends strongly on AI spending and on Taiwan chip production") so the Exposures pages have something to show. They are labelled "Demo data: illustrative only, not reviewed", they use 12 factors taken from the draft list, and they live only in the demo database. They are not a substitute for the reviewed taxonomy, which is still waiting on you.

**16.4 Demo news is invented and every title starts with "[DEMO]".** Final. Who: Me.
Thirty items with plausible types and importance scores, two with syndicated copies. They are about real tickers, so the prefix and the banner are there to prevent any confusion.

**16.5 The Terminal is a separate dark, dense page.** Final. Who: Me.
Why a new page instead of crowding the dashboard: the dashboard stays readable for a beginner, and the Terminal is for someone who wants everything at once. It turns the app's dark theme on only while it is open. It has twelve panels: portfolio index, performance by period, holdings monitor (with 60-day mini charts), risk, risk versus weight, return distribution, rolling volatility, monthly returns, worst drawdowns, correlation, hidden exposure and relevant news.

**16.6 Risk measures are computed from history, not from a formula.** Final. Who: Me.
Value at risk (95% and 99%) is the actual 5th or 1st worst daily return in the window, and expected shortfall is the average of the days at or beyond it. Why: it needs no assumption that returns look like a bell curve, which they do not. Limits: with about two years of data, the 99% figure rests on only a handful of days, and the past is not a promise.

**16.7 "Share of risk" is each holding's share of the portfolio's variance.** Final. Who: Me.
It accounts for how holdings move together, not just their own size. The shares add up to 100% and can be negative for a hedge. A holding turns amber when its share of risk is more than 25% above its weight (the 25% is my choice).

**16.8 The Terminal uses two years of history and has no benchmark.** Open. Who: Together.
I did not add "versus the market" figures (beta, alpha, tracking error) because the app has no market index data yet. Adding it needs an index price series, which needs a data provider key.

**16.9 Every number in the Terminal comes from the same tested functions as the other pages.** Final. Who: Me.
The browser tests check that the Terminal's volatility, drawdown, Sharpe and total return equal the Dashboard's, that risk shares add to 100%, that monthly returns compound back to the total, and that the histogram counts every day.

**16.10 The Guide is a plain page, not an interactive tour.** Final. Who: Me.
It has a five-minute tour with links, six key ideas with analogies, a section for each Terminal panel, a glossary of twelve terms, and an honest section on data limits. Every "?" on a Terminal panel links to its explanation, and a test checks every one of those links lands on a real section. Why not a pop-up tour: it would add fragile moving parts, and a page you can read at your own pace and link to is easier to keep correct.

**16.11 Links that look like buttons are real links.** Final. Who: Me.
A library component was turning "Create a portfolio" into something screen readers announced as a button. They are now ordinary links with button styling, which also removed a warning in the browser console.

**16.12 The app creates your session before its first data request.** Final. Who: Me.
Before this, a brand-new visitor's first request failed with a 401 (hidden by an automatic retry but visible in the console).

**16.13 Accessibility problems the automatic scanner found, now fixed.** Final. Who: Me.
Sample buttons had a spoken name that did not contain their visible words, and two wide tables could not be scrolled with the keyboard. Both fixed, and the scanner now checks the Terminal in its dark theme as well.

### Mistakes in this slice

- The guide page file was not created the first time because I forgot to create its folder; I noticed from the error and wrote it again.
- Several string replacements silently failed because the code formatter had reflowed the lines. I now check that a replacement actually applied.
- I assumed the sample "no price history" test ticker would stay unpriced; adding demo prices made it priced, and the test caught it.
- The first browser run of the empty dashboard showed a console warning that my earlier tests never saw, because they only visited pages with data.

---

## 13. Mistakes made and fixed (for honesty)

- I miscounted the factor list as 34 when it was 31. Fixed in the doc.
- A broad text replacement briefly damaged two rows of the roadmap's risk table. Caught and restored.
- When undoing a deliberate test breakage I accidentally discarded my own uncommitted delete-portfolio code. Noticed at once and rewritten identically.
- Early versions of the grounding check missed numbers inside labels and the word "reducing". Both were found by tests and fixed.
- Several failing tests were my own wrong assumptions, not app bugs, such as the ordering of search results.
