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

**16.14 In demo mode, an empty session gets the five samples automatically.** Final. Who: Me, because you asked for the mock portfolios to be created "for you".
Portfolios belong to a browser cookie, so I cannot create them in your browser ahead of time. Instead, when the app is running in demo mode (`pnpm demo`) and it sees a session with no portfolios, it loads the samples itself and shows "Setting up your demo portfolios" for a moment. Outside demo mode nothing changes: you still see "You have no portfolios yet" with buttons. Loading never duplicates, so reloading is safe.
How I checked: a brand-new browser opened the dashboard and landed on a populated page with five portfolios, and a reload still showed five. This behaviour depends on a build-time switch, so the automatic browser suite (which runs without demo mode) does not cover it.

### Mistakes in this slice

- The guide page file was not created the first time because I forgot to create its folder; I noticed from the error and wrote it again.
- Several string replacements silently failed because the code formatter had reflowed the lines. I now check that a replacement actually applied.
- I assumed the sample "no price history" test ticker would stay unpriced; adding demo prices made it priced, and the test caught it.
- The first browser run of the empty dashboard showed a console warning that my earlier tests never saw, because they only visited pages with data.

---

## 17. The redesign: shared theme, news cards, Terminal workspace, exposure map, Dashboard (added 2026-10-21)

You asked for these changes after reviewing the app: news that is more than text, a Terminal that does not scroll and is split into sections, one light/dark setting for the whole app with a button in the sidebar, a graph of what influences what, and a Dashboard that stops repeating the other pages.

**17.1 One theme for the whole app, switched in the sidebar.** Final. Who: Me (you asked for it; the details are mine).
The choice is stored in the browser (key `pl-theme`). With nothing stored, the operating system's preference is followed; a stored choice always wins. A tiny script in the page head applies it before anything is drawn, so there is no flash of the wrong theme. The toggle announces "Dark mode: on/off". The Terminal no longer forces its own dark look: it follows the same setting as every other page.
If browser storage is blocked, the toggle still works until you close the page.

**17.2 Colors have meanings, and they work in both themes.** Final. Who: Me.
I added named colors for gain (green), loss (red), caution (amber) and information (blue), each with a darker text version for light mode and a lighter one for dark mode, chosen to pass the contrast check. Charts read their colors from the same names, so they change with the theme too. Color is never the only signal: gains and losses carry a plus or minus, severities and news types carry a word and a shape.

**17.3 News is shown as cards.** Final. Who: Me.
Each card has a ring that fills with the 0 to 10 relevance score and a word under it (High from 5, Medium from 2, Low below 2: my cut-offs), a type badge with its own symbol (diamond, half circle, empty circle), a ten-block importance meter, chips for the holdings it touches with their weight, a "what it means" line from the classifier, and the "why am I seeing this" breakdown shown as three small bars. The top story spans the page; the rest sit in two columns; low-relevance ones stay folded away. Type filters are buttons with counts (clicking "Narrative 3" shows those three).

**17.4 The Terminal is a workspace of four sections.** Final. Who: Me.
Overview (index chart, performance, holdings), Risk (risk table, risk versus weight, rolling volatility, drawdowns, distribution), Calendar (monthly returns with a yearly total, plus the five best and five worst days) and Context (hidden exposure, correlation, news). Press 1 to 4, or use the arrow keys, Home and End. The section is kept in the address (`/terminal#risk`), so links, Back and Forward work. On a desktop screen the page never scrolls: each section is laid out to fit the window, and anything that would not fit scrolls inside its own box. On a phone the panels stack normally.

**17.5 On desktop the window itself no longer scrolls.** Final. Who: Me.
To let the Terminal fill the screen exactly, the sidebar stays put and each page scrolls inside the main area. Every page looks the same as before; the change is where the scrollbar lives.

**17.6 The hidden exposure map is a flow diagram.** Final. Who: Me.
Holdings on the left, economic forces on the right, one line per dependency. Line thickness is weight times the strength of the exposure (so a big holding with a strong exposure draws a thick line), green means "helped when the force rises", red means "hurt". Each box is as tall as its lines added together, so lines never overlap inside a box. Hover or focus a name to isolate its connections; click or press Enter to pin it. A list below names the forces that touch several holdings, which are the hidden links. The layout is a separate, tested function.
Trade-off: with many holdings and forces the lines get thin and busy. The heatmap table below remains the precise view.

**17.7 The Dashboard answers "what should I know now?", and other pages own the detail.** Final. Who: Me.
It now shows: six key figures, up to six insight cards, the index chart next to a compact holdings list, the day-move card (its tables folded away), the top three news cards, and the AI explanation. I removed the sector bar chart, the drawdown chart and the large holdings table from it, because the Terminal and Exposures pages cover them. Cost: there is no longer a sector allocation chart anywhere; sector appears as a column in the Terminal's holdings monitor and in the effective-sectors figure.

**17.8 Insight cards are plain rules, not AI, and these are the thresholds.** Revisit. Who: Me.

- Hidden concentration: "watch" if the effective number of forces is below the effective number of sectors, otherwise "info". Without exposure data, "watch" if the largest holding is 30% or more.
- Risk driver: "watch" if a holding's share of risk is more than 25% above its weight.
- Biggest force: shown, as "watch", if one force is 25% or more of exposure.
- Drawdown: "watch" at 5% below the peak, "alert" at 10%.
- Latest day: "watch" if the portfolio moved 1.5% or more.
- Correlation: "watch" at an average of 0.60 or more.
- News: "watch" if the top story scores 5 or more.
  Cards are sorted alerts first, then watches, then information. All the numbers in the thresholds are my judgment and sit together in one place in the code.

**17.9 First visits now create exactly one session.** Final. Who: Me, after a test found the bug.
Two parts of the page both asked for a session at the same instant, so two were created and the later cookie replaced the earlier one, orphaning anything created in between (in the demo, the sample portfolios could land in a session you then lost). All callers now share a single request.

**17.10 Two interaction bugs the new tests found, now fixed.** Final. Who: Me.
Keyboard users could not pin a node in the exposure map, because focusing it already activated it and Enter then toggled it off; preview (hover and focus) and pin are now separate. And changing the address hash or pressing Back did not change the Terminal section; it now listens for that.

**17.11 Accessibility.** Final. Who: Me.
The scanner found that the gray "Not yet classified" and "Noise" badges were too faint, and that graph nodes' spoken names did not begin with their visible text. Both are fixed. The scanner now checks the main pages in both themes, and each Terminal section in both themes.

**17.12 Selects have real names.** Final. Who: Me.
The Period and Holding selectors on the News page now carry an explicit accessible name.

### Mistakes in this slice

- Several of my test edits again silently failed because the code formatter had reflowed the lines; I now confirm each replacement took effect.
- I miscounted nested lists in the news cards (each card contains a small list of holding chips), which made counts double; tests now count only direct children.
- One of my tests used a card title as if it were a heading; card titles are not headings, so the test was wrong, not the page.
- My first version of the Terminal test for the hover effect never actually checked that the highlight is removed afterwards; it does now.

---

## 18. Stress Lab and Discovery (added 2026-10-21)

**18.1 Stress Lab is a simple, labelled what-if, not a forecast.** Revisit. Who: Me.
You pick a scenario (or drag sliders for individual forces, from "falls a lot" to "rises a lot"). Each stock's estimated move is its exposure to that force times the shock times 3% per exposure point, so a stock with exposure 3 under a full shock moves about 9%. The portfolio estimate is the weighted sum. The 3% is my assumption, not a measurement, so the page says so, and forces are treated as independent. Doing it as plain arithmetic keeps it explainable and testable by hand.

**18.2 Vulnerability score.** Revisit. Who: Me.
0 to 10, where a portfolio loss of 10% or more scores 10 and a gain scores 0. The 10% anchor is my judgment.

**18.3 Reliability is shown next to every estimate.** Final. Who: Me.
It is the confidence of the exposures behind the number, weighted by how much each one contributes, so a result built on low-confidence guesses looks different from one built on solid ones.

**18.4 Six preset scenarios.** Revisit. Who: Me.
Rate jump, oil spike, AI pullback, Taiwan disruption, recession, strong dollar. Each is a mix of forces with sizes I picked. A preset only appears if the portfolio is exposed to at least one of its forces.

**18.5 Both pages need every holding covered.** Final. Who: Me.
Same rule as the Exposures page: a partial analysis would understate risk, so the pages say what is missing instead.

**18.6 Discovery ranks by the metric we agreed on, and shows the catch.** Final. Who: Me (you said it was my call).
Candidates are ranked by how much the effective number of hidden forces rises if added at 3, 5 or 10%. Testing found a flaw in that metric for hedges: a stock that cancels out one force lowers your total hidden exposure but can lower the effective-forces count, because the measure rewards spread, not smallness. So every candidate that shrinks total exposure is tagged "Hedge" with a plain explanation, and the code also records the change in total exposure. I did not change the agreed metric; I made its blind spot visible.

**18.7 Discovery is a screen, never advice.** Final. Who: Me.
Titles say "research candidates", the page says they are not recommendations and say nothing about return, and held stocks are never suggested.

### Mistakes in this slice

- My first test expected hedges to raise the effective-forces count. The math showed the opposite, which is how the blind spot in 18.6 was found.
- I expected the stress table to list the biggest per-stock move first; it orders by effect on the portfolio, which is what matters.

---

## 19. Research page and assistant (added 2026-10-21)

**19.1 One research page per company, public data only.** Final. Who: Me.
The page shows the price chart, return and volatility statistics, hidden exposures with confidence, similar companies, recent news cards and a "what if you add it" panel. It needs no portfolio except the last panel. Fundamentals (earnings, valuation) are not shown, and the page says so, because we have no free data source wired up for them and I would rather say that than show invented numbers.

**19.2 "Similar companies" means similar hidden exposures.** Revisit. Who: Me.
Companies are compared by the angle between their exposure profiles (1 means the same pattern, 0 unrelated, negative opposite). If the company has no exposure profile, the page falls back to companies in the same sector and labels them that way.

**19.3 A company's own news is scored with a neutral position size.** Revisit. Who: Me.
The News page weights stories by how much of your portfolio they touch. A company page has no portfolio, so every story is scored as if the company were a quarter of a portfolio, which means the score reflects the story itself.

**19.4 The assistant never answers from memory.** Final. Who: Me.
It can only call six tools (portfolio summary, hidden exposures, company data, news, what-if add, stress scenario). Each returns numbered facts. The answer may only use numbers from those facts and must cite them, using the same checker as the portfolio explanation. A bad answer gets one retry with the problems listed, then is replaced by the figures themselves. An answer given without calling any tool is rejected.

**19.5 Same safety rails as before.** Final. Who: Me.
Questions are 3 to 500 characters. Each question counts against the same 10-per-hour allowance as the other AI features. Tool calls are limited to four rounds. Tools only see the asking session's own portfolio. The assistant never gives buy or sell advice and says so in its instructions and in the checker.

**19.6 No conversation memory yet.** Revisit. Who: Me.
Each question stands alone. A back-and-forth chat would need stored history, a length limit and a decision about what to cache, which I would rather agree on with you than guess.

**19.7 Answers are not cached.** Final. Who: Me.
Unlike the portfolio explanation, questions are free text and rarely repeat, so caching would add storage for little benefit.

### Mistakes in this slice

- The build failed once because the sidebar reads the current address, which needs a loading boundary on pages whose address varies. Fixed by wrapping the sidebar.
- One of my tests looked for the rejected invented number anywhere in the response; it is deliberately kept in a diagnostic field, never in the answer, so the test now checks the answer.
- An old test still expected the Research placeholder text and was updated.

---

## 20. Reactions: the event study (added 2026-10-21)

**20.1 Built in TypeScript with the rest of the math, not in the Python service.** Revisit. Who: Me (you said it was my call).
The roadmap planned this in Python. The method is a simple regression and a t-test, which sit naturally beside our other tested finance code, and keeping one language means the end-to-end tests need no extra service. The Python service stays available for heavier statistics later.

**20.2 The method.** Final. Who: Me.
For each story and each stock it is linked to, we fit "how this stock normally moves when the market moves" on the 250 to 30 trading days before the story, then compare what actually happened on and after the event day. The difference is the abnormal return. We add it up over 1, 2, 6 and 11 days (event day, 1, 5 and 10 days after) as far as those days have already happened. The model never sees the days after the story, and a test proves a huge shock cannot change the fitted model.

**20.3 The market is the average of the other stocks we have prices for.** Revisit. Who: Me.
We have no free index price series, so the market proxy is the equal-weighted average of every other stock in our price universe that day (leaving the stock itself out), and at least five others are required. With the full S&P 500 loaded this is a reasonable stand-in; with the 25-stock demo set it is rough, and the page says so. When real index prices are available, they should replace it.

**20.4 Event day is when the price could first react.** Final. Who: Me.
A story published before the close counts on that day; one published after the close or on a weekend counts on the next trading day. This reuses the earlier market-session logic.

**20.5 Averages by type of news carry a sample-size warning.** Final. Who: Me.
Each type shows the average, a 95% range from a seeded resampling (so the same data always gives the same range) and a t-statistic. With fewer than 5 events the row says "Too few events to judge". A t of 2 or more is described as "distinguishable from zero", never as proof.

**20.6 Stories not yet classified are skipped, and the page says how many.** Final. Who: Me.
So are stories with no price on the event day and stocks with less than about three months of earlier prices. Nothing is silently dropped.

**20.7 Not built, on purpose.** Open. Who: Me.
Dropping or flagging events that overlap earnings releases, the cross-stock test of whether stocks the exposure map says are affected really moved differently, writing results to a stored table, and loading historical events from SEC 8-K filings. The last is the most valuable and free, but it only pays off once real historical prices exist, and the only price source we have without a key is made-up fixtures, so I did not build a pipeline I could not check.

### Mistakes in this slice

- My first flat-market check compared to exactly zero, so a constant market series slipped through because of rounding. A test caught it; it now uses a small tolerance.
- Two of my test expectations were wrong about the demo data (the size of the stock universe, and which horizons exist for a story six weekdays old). The page was right both times.

---

## 21. The research study module (added 2026-10-21)

**21.1 The study is built, switched off by default, and cannot collect anyone's data until you turn it on.** Final. Who: Me.
It needs `EXPERIMENT_ENABLED=1`. The full design, analysis plan, sample size and an ethics checklist are in `docs/experiment-design.md`. Running it on real people needs an ethics approval that only you and your school can obtain, so the consent wording in the app is a stand-in that must be replaced.

**21.2 The question.** Final. Who: Me.
Do people who can see their hidden exposures build portfolios that depend less on any one hidden force? The main measure is the factor HHI from ADR 0004, computed identically for both groups by the server from the submitted portfolio.

**21.3 Two groups, assigned by the server, balanced within experience levels.** Final. Who: Me.
Each new participant goes to whichever group is smaller for their experience level (new, some, experienced); ties are a coin flip. A database lock makes this safe when two people join at once, and a test checks the groups never differ by more than one per level.

**21.4 The control group is blocked from exposure data by the app itself, not by hiding buttons.** Final. Who: Me.
Anyone enrolled can only reach the study page and study API. Every other page redirects and every other API returns "forbidden", so no part of the product can leak exposure data to the control group. The study's own responses for the control group contain no exposure fields, and tests check both.

**21.5 What gets recorded.** Final. Who: Me.
Choices, two short questionnaires before and after, and interaction events (adds, removals, weight edits, page hidden or visible, submit). No names, emails or IP addresses, and the participant id lives only in a cookie. A Withdraw button deletes everything about the participant.

**21.6 The researcher gets a CSV and a ready-made analysis, behind a secret token.** Final. Who: Me.
The analysis uses a permutation test (no assumptions about the shape of the data), Welch's t and Cohen's d. The CSV defuses spreadsheet formulas. The token must be at least 16 characters, and with no token set the endpoints do not exist.

**21.7 Sample size guidance.** Revisit. Who: Me.
65 per arm detects a medium effect (d = 0.5) with 80% power; a small effect needs about 393 per arm. A pilot should measure how much factor HHI varies before the target is fixed.

**21.8 The study universe.** Open. Who: You.
By default participants choose from every company that has exposure data. A real study should fix a list (`EXPERIMENT_UNIVERSE`) of maybe 20 to 40 companies whose exposures have been reviewed. That list is a research decision.

### Mistakes in this slice

- The preview request sent a bare list where the server expects an object, so the portfolio summary never appeared in the browser. The page test caught it; no API test could have, because the API tests sent the right shape.
- I first wrote an accessible label ("Add AAPL") that stopped matching the button's visible text after clicking ("Added"). The scanner caught it.
- Two of my tests assumed a clean database and picked up rows from an earlier run; they now identify the participant by their own cookie.
- To get at least five companies with exposure data into the test database I added six extra ones, which changed the counts expected by two earlier tests. I updated those tests.

---

## 22. Real data (added 2026-10-21)

**22.1 We found free real data that needs no key, so the app can now run on real numbers.** Final. Who: Me (you said no paid data).
Prices come from Yahoo Finance's public chart service and filings and company financials from the SEC's EDGAR service. Both are free and need no account. Real S&P 500 prices for five years (about 622,000 daily rows, all 503 companies) loaded without a single failure.

**22.2 Yahoo is unofficial, so it is treated as research-grade.** Revisit. Who: Me.
Yahoo has no published terms or limits for this use and can change or block it at any time. The code is behind the same provider interface as the paid option (Tiingo), so swapping later is one line. It requests slowly (about three per second), drops today's unfinished bar, and has tests for the awkward cases (holidays, share-class tickers, missing adjusted close). Before anything public or commercial, replace it with a licensed source.

**22.3 The real data lives in its own database, `pl_real`, never mixed with the fake data.** Final. Who: Me.
Fake and real prices in one table would be silently confusing (the loader skips days it already has). Build it with `pnpm real:seed` (prices and exposures) and `pnpm data:sec` (filings and fundamentals), then run it with `pnpm real`. The demo and test databases are unchanged.

**22.4 The hidden exposures in the real database are still the illustrative ones.** Open. Who: You.
Only 24 companies have them, labelled "illustrative only, not reviewed". Real hidden-exposure data needs the reviewed factor taxonomy and curated exposures, which is your decision and work.

**22.5 SEC 8-K filings become events by fixed rules, not by the language model.** Final. Who: Me.
Each Form 8-K lists numbered items (for example item 2.02 is an earnings release, 5.02 is an executive change). A fixed table maps items to our event types and importance. The event time is the exact moment the SEC accepted the filing, so there is no guessing about when the market could first react. The importance numbers are my judgment. One extra event type, "Earnings release", was added because an 8-K does not say whether results beat expectations; the language-model list is untouched.

**22.6 Fundamentals come straight from SEC annual reports.** Final. Who: Me.
Revenue, operating and net income, diluted EPS, operating cash flow, assets and equity for the last five fiscal years, with restated figures replacing originals. Ratios (growth, margins, return on equity, price to earnings) are computed by tested code and labelled with how they are defined. Spot checks against known figures matched (Apple FY2025 revenue $416.2B, diluted EPS $7.46).

**22.7 The Reactions page on real data gives sensible answers.** Final. Who: Me.
About 5,000 real earnings events, studied in about 2.5 seconds. The average earnings reaction is about zero (+0.06%, t 0.6), as expected when good and bad surprises cancel, so the page now also shows the typical size of a move regardless of direction. The largest reactions are real and recognizable (for example Centene, July 2025, about -40%), which is a good sign the machinery lines up dates and prices correctly.

**22.8 More study details.** Final. Who: Me.
News within a week of an earnings or guidance event for the same stock is left out of that news type's average and labelled, since the two cannot be separated. The study also reports 30-day cumulative reactions. The study participant cookie is now signed, so an edited or invented id is refused; a debrief screen explains the two groups after submission. Discovery can be filtered by sector.

**22.9 The assistant remembers the last few turns, as context only.** Final. Who: Me.
Up to the last 4 verified answers are sent along with a new question so follow-ups like "and which news matters most?" make sense. Numbers in earlier turns are not facts: the assistant is told to call the tools again for any figure, so the grounding check still applies to every number in a new answer. Answers that fell back to figures only are not carried forward. Nothing is stored on the server; the conversation lives in the page and resets when you switch portfolios.

**22.10 Holdings can be exported as a CSV.** Final. Who: Me.
One row per holding (weight, latest price, recent returns, share of risk), downloadable from the toolbar on any portfolio page, for the owner only.

### Mistakes in this slice

- I started the big price download twice by backgrounding a command that was already in the background, so the first attempt silently died; I noticed because the log had no summary line.
- A test fixture used a Saturday date, and the app correctly labelled it a closed-market day.
- An accessibility test failed about one run in four because the scanner measured a button in the middle of a colour transition; the scan now waits for animations to finish.

---

## 23. Professional UI, new analysis tools, explanations and onboarding (added 2026-10-22)

**23.1 A brand colour and a real layout system.** Final. Who: Me (you asked for a professional look).
The grey-only palette became a deep blue on cool neutral surfaces, in light and dark, with matching chart colours. Every page now has the same header (title, one-sentence description, actions). The sidebar has the logo, grouped sections (Overview, Analyze, Market, Help) and icons. Loading states are skeleton placeholders instead of the word "Loading" (screen readers still hear "Loading"). The main equity and price charts use a soft gradient. All text and structure that tests and screen readers rely on is unchanged.

**23.2 Rebalance Lab: compare weightings, never recommend.** Final. Who: Me.
It compares your weights with equal weights, the lowest-volatility mix (long-only, with a cap on any one holding you choose) and equal-risk weights. The math is a standard convex optimisation checked against closed-form answers. Every number is "in-sample": fitted and measured on the same past three years, so the alternatives look better than anyone could have known in advance, and the page says so. I left out a "best return" optimiser on purpose: it chases noise in past returns.

**23.3 Simulation: possible paths from your own history.** Final. Who: Me.
Circular block bootstrap (blocks of 10 days, so short streaks survive) over the portfolio's last three years, 2,000 paths, seeded so the same inputs give the same picture. It shows percentile bands, the chance of a loss, and the typical worst drop. It is labelled a projection of the past, not a forecast.
By default the paths are centred on a typical long-run 7% a year instead of the portfolio's own past average. The first version replayed a mega-cap tech portfolio's +41% a year and reported a 0% chance of loss over three years, which is a boom assumed to repeat, so I re-centre the history (keeping its volatility and shape) and offer a toggle for the past average. The 7% is my judgment, in one place in the code.

**23.4 "In plain English" on every new tool.** Final. Who: Me.
Stress Lab, Rebalance Lab and Simulation each have a button that writes a short explanation. The server recomputes the tool's figures itself (the browser cannot supply numbers), and the same checks as before apply: every number must come from those figures, citations must exist, no advice wording, otherwise only the figures are shown. Results share the 10-per-hour allowance.

**23.5 A collapsed "How to read this" note on every analysis page.** Final. Who: Me.
Plain language: what the page shows, how to read it, what to be careful about. Collapsed by default so experienced users are not slowed down.

**23.6 Onboarding: a non-blocking welcome, a checklist, and a guided tour.** Final. Who: Me.
First-time visitors see a card offering a two-minute tour; it never blocks the page. A checklist ticks itself off as pages are opened and can be hidden. The tour has 8 steps, moves between pages, and spotlights real elements (portfolio picker, key numbers, insight cards, exposure map, Stress Lab controls, assistant, Guide). It works by keyboard (arrows, Escape, focus stays inside), restores focus when it closes, and can be replayed from the sidebar, the Guide or the checklist. Progress is kept only in your own browser; blocked storage just means it is forgotten on reload. I chose a card over a pop-up that appears by itself because an unrequested overlay is the thing people close without reading.

**23.7 On a phone the menu folds behind a button.** Final. Who: Me.
Checking the redesign on a phone-sized screen showed the whole grouped menu filling the first screen, with the actual page below the fold. Below the tablet breakpoint the menu is now closed behind a button (with expanded/collapsed state announced) and closes when you pick a page. On larger screens nothing changes.

**23.8 Still open.** Open. Who: You.
Whether to translate the plain-language notes and tour into other languages, and whether the tour should be shown automatically to new users of a deployed version.

### Mistakes in this slice

- My first Simulation, run on the real data, said a tech-heavy portfolio had a 0% chance of losing money over three years. The code did what I wrote; the assumption was wrong. Looking at it on real numbers, not just in tests, is what caught it.
- Opening the dev server by its numeric address made the browser silently skip the page scripts, so my first screenshots showed only "Loading". Using localhost fixed it; the deployed app is unaffected.
- A keyboard bug that was already in the exposure map only showed up after the new layout pushed the map lower on the page: focusing a node scrolled the page, a parked mouse "left" the graph, and that cleared the highlight. Mouse and keyboard state are now separate.
- Several older tests looked up phrases that my new explanatory notes repeated, and two scrollable tables lacked keyboard focus. The notes were reworded and labelled tables are now focusable.

---

## 24. AI-drafted exposure profiles for the whole index (added 2026-10-22)

**24.1 Draft hidden-exposure scores for every S&P 500 company, labelled as unreviewed.** Final for now. Who: Me (you said it was my call).
Only 24 companies had exposure scores, so most real portfolios could not use the main feature. A drafting tool now asks the language model, one company at a time (the real-data database now has drafts for all 479 remaining companies: 1,629 scores, no failures), which of the 12 forces clearly matter to it, how strongly, in which direction, with a one-sentence reason. Each stored row says "AI-drafted, not reviewed" in its reason and is recorded as an AI draft, never as manual. The app shows that label on the Exposures page ("N of M scores are AI drafts that no person has reviewed") and on every company's exposure list.

**24.2 Reviewed data can never be overwritten.** Final. Who: Me.
The tool skips any company that already has a current profile, hand-made or drafted. Drafted confidence is capped at 0.8 (never higher), unknown forces are discarded, there are at most 6 forces per company, and duplicates keep the strongest. Tests cover each rule.

**24.3 How good are the drafts? Measured, with an honest caveat.** Final. Who: Me.
I had the model draft the 24 companies that have hand-made profiles and compared them. Averages: cosine similarity 0.84 (1 is identical), direction agrees on 94% of the forces both profiles contain, 94% of the strong forces in the hand-made profile were also found, and 83% of the draft's strong forces appear in the hand-made one. The caveat that matters: the hand-made profiles were also written by an AI (me), so this measures consistency between two drafts, not accuracy against the real world. A human review against company filings is still needed before anyone relies on these.

**24.4 Still your call.** Open. Who: You.
Whether to adopt the 12-force list or the longer draft taxonomy, and who reviews the drafts. The reviewing workflow (accept, edit, reject per company) is not built yet.

### Mistakes in this slice

- My first agreement test asserted the wrong number against its own comment (a mean error of 0.5 written as 1); the code was right.

---

## 25. Exposure review workflow (added 2026-10-22)

**25.1 A review tool at /review so the AI drafts can be checked, edited and approved.** Final. Who: Me.
It lists companies by status (AI draft, illustrative, reviewed, no profile) with search. For a company you can change each force's strength and direction, edit the confidence and the reason, remove a force or add one, then save. A summary shows how many drafts remain.

**25.2 Every save is a new version; nothing is erased.** Final. Who: Me.
Saving closes the current rows and stores the reviewer's as the next version, marked manual, with the reviewer's name and the time. Earlier versions stay in the table. The "AI-drafted" label is removed from the reason when a person approves it, so the app then shows the scores as reviewed everywhere. Strength must be 1 to 3, direction one of two values, each force at most once, and every row needs a reason a reader can check.

**25.3 Access is a secret token, off unless you set one.** Final. Who: Me.
The tool exists only when `REVIEW_TOKEN` (16+ characters) is set on the server; without it the pages and API do not exist. The token is compared in constant time and kept only for the browser tab. There are no user accounts, so the reviewer's name is typed and recorded, not verified. That is fine for one researcher or a small team on a trusted deployment; it is not an audit-grade identity.

**25.4 Review standard.** Open. Who: You.
What counts as "reviewed" (checked against the 10-K business description? a second person?) is a research decision. The tool records who and when, not how carefully.

### Mistakes in this slice

- My lint-clean first draft loaded data from a helper that set state directly from an effect, which the project's lint rule rejects; it now uses the same promise-chain pattern as the rest of the app.
- A test that edits shared fixtures can only run once per seeded database; re-running it alone fails for that reason, which is why the full run reseeds first.

---

## 26. Do similar hidden exposures move together? A test on real events (added 2026-10-22)

**26.1 A test of the product's central claim, run on real data.** Final. Who: Me.
When a large company reports earnings, we take every other stock's abnormal return that day, flip its sign so that "moved the same way as the company" is positive, and correlate it with how similar the stock's hidden exposures are to the company's. One correlation per earnings day. The pooled average answers: do exposure scores capture real shared economic drivers? It is a page section on Reactions, for any large company with at least four earnings events.

**26.2 The sector control.** Final. Who: Me.
The obvious objection is that similar exposures just means "same sector". So every day also gets a sector-adjusted (partial) correlation that removes what sharing the company's sector explains. Positive after that adjustment would mean exposures add something the sector label does not.

**26.3 Result.** Final, with caveats. Who: Me.
Pooling 121 earnings days across 11 bellwethers (NVDA, AAPL, MSFT, AMZN, GOOGL, META, JPM, TSLA, AVGO, WMT, UNH), the average correlation is +0.055 (t 4.15, 95% range +0.029 to +0.081, positive on 65% of days). After the sector adjustment it is +0.041 (t 3.84, range +0.020 to +0.062). The fifth of stocks most similar to the reporting company moved about 0.27 percentage points more in its direction than the least similar fifth. It varies a lot by company: strongest for the chip companies (AVGO +0.12 and NVDA +0.09 sector-adjusted), none for AAPL, AMZN and UNH. So: a small but statistically distinguishable effect, most of which survives the sector control.

**26.4 Caveats that matter.** Final. Who: Me.
Earnings days are not fully independent (several companies report in the same weeks, and market-wide moves repeat), so the t-statistics are likely too generous. The exposure scores are AI drafts, and a language model may carry knowledge of how companies are related that is not in the 12-force list. The effect is small in absolute terms: one company's earnings are a faint signal for another. This is evidence that the exposure map reflects something real, not proof, and not a trading signal. The numbers were computed once from the live API; the page recomputes them from the current data.

**26.5 Not built.** Open. Who: Me.
A version that clusters standard errors by calendar week to fix the independence issue, a placebo test with shuffled exposure profiles, and an automatic pooled view across all bellwethers in the app (it takes about a minute, so I kept the one-company view and reported the pooled result here).

### Mistakes in this slice

- A constant series looked like it had a tiny variance because of rounding, so a correlation of exactly zero was reported instead of "not defined"; a tolerance fixed it (same class of bug as in the event study).
- My first version of this test had no sector control. The obvious objection would have been fatal, so I added it before reporting anything.

---

## 27. Real-data testing, import, market comparison and a printable report (added 2026-10-23)

**27.1 The browser tests never touched real data, so I added a suite that does.** Final. Who: Me (you asked whether everything was tested end to end).
`pnpm --filter @portfolio-lab/web e2e:real` runs 16 read-only checks against the real-data database: price histories are long and clean (no non-positive prices or duplicate days, almost no absurd one-day jumps), the SEC figures match well-known facts (Apple's fiscal 2025 revenue of $416,161,000,000 and diluted EPS of 7.46), every company has an exposure profile and none is mislabelled as reviewed, the event study finds Centene's roughly 40% collapse on 2 July 2025, every analysis returns finite plausible numbers for all five sample portfolios, and no page anywhere shows NaN, Infinity or a script error. It writes nothing and never calls OpenAI.

**27.2 What is still not automated.** Open. Who: Me.
Real Yahoo, SEC and OpenAI calls (they were checked by hand, not by tests, because they depend on outside services); the `pnpm demo` and `pnpm real` launchers; real news providers (no keys); browsers other than Chrome; load or speed testing; and GitHub's CI, which GitHub refused to start for an account billing reason.

**27.3 Import your own portfolio.** Final. Who: Me.
Paste a list or a broker export, or load a CSV. It understands percentages, dollar values and share counts, with or without a header row, thousands separators, brokers' share-class spellings (BRK-B, BRK/B), and skips cash, totals and short positions saying why. Share counts are converted to weights at the latest close; tickers outside the S&P 500 are listed and left out; unpriced shares are left out and reported. You see exactly what was understood before anything is created, and only tickers and numbers are sent to the server.

**27.4 Market comparison against the S&P 500.** Final. Who: Me.
Beta, alpha, correlation, tracking error, information ratio, up and down capture, share of days beating the market, a rolling beta and calendar-year returns, against SPY loaded into its own table (real Yahoo data in the real database). Alpha is defined plainly: the average daily return left after removing beta times the market's return, times 252. The page warns that a few years of data make alpha noisy and not skill. Tests recompute every statistic independently from the returned curves.

**27.5 A printable report.** Final. Who: Me.
One page of key figures, what to know, holdings, hidden concentration, market comparison and three illustrative stress scenarios, with the standard disclaimer and labels for unreviewed exposure scores. The browser's print dialog saves it as a PDF. Print styles hide the sidebar, controls and button.

### Mistakes in this slice

- I wrote a test assuming GOOGL had no prices; it is one of the 24 demo tickers. The test now uses a company that really has none.
- My first "page has finished loading" check in the real-data suite waited for any status element to disappear, but Recharts' tooltip keeps one forever. The check now looks for the loading placeholder specifically.
- A chart-count check counted legend icons as charts.
- Two accessibility scans were flaky because buttons were mid-colour-transition; they now wait for animations to finish.

---

## 28. A rebalancing strategy built on hidden exposures (added 2026-10-25)

**28.1 Smallest net exposure.** Final. Who: Me.
Rebalance Lab now has a fifth alternative built from the exposure scores instead of prices: the mix whose net dependence on every economic force (the sum over forces of the squared net loading) is smallest, with the same cap on any one holding. It reuses the optimiser already in the app, applied to the matrix of inner products of the holdings' exposure vectors; tests check that the optimum is exact for hand-built cases (opposite exposures cancel at equal weights) and that no other mix has a smaller net dependence. It appears only when every holding has a profile. Each strategy now also shows its effective number of forces.

**28.2 What it does, on real data, and why the page warns about it.** Final. Who: Me.
It does what it says but not always what you might hope. On the Balanced sample it cut the net dependence but lowered the effective number of forces from 6.1 to 3.8 and raised volatility from 12.2% to 18.3%; on Mega-cap tech it lowered both effective forces (7.6 to 6.3) and volatility (24.1% to 21.7%). The reason is that it works by concentrating in names whose exposures cancel. That is the same blind spot as the Hedge tag in Discovery: "least exposed" is not "most diversified". So the strategy is named "Smallest net exposure", its description and the page's note say it can raise volatility and reduce effective forces, and every column is shown side by side.

**28.3 It is only as good as the scores.** Final. Who: Me.
Cancelling exposures only works if the exposure scores are right, and most are unreviewed AI drafts. The page says so next to the strategy.

### Mistakes in this slice

- A News test passed all week and failed on a Sunday: the fixture story is "six weekdays ago", which is nine calendar days over a weekend, so its relevance score decayed below the collapse threshold and the story was hidden in the low-relevance group. The app was right; the test now opens that group first. Tests tied to "today" need to survive any day of the week.
- I first named it "Least hidden exposure", which suggests a better, safer portfolio. Seeing the real numbers showed that is not what it delivers, so I renamed it and rewrote its description before anyone relied on it.

---

## 29. Compare two portfolios (added 2026-10-25)

**29.1 A side-by-side page.** Final. Who: Me.
Pick any two of your portfolios and see, over the dates both have prices for: yearly return, volatility, worst fall, Sharpe ratio, effective sectors and forces, market beta and biggest economic force, with the better value in each row marked, a growth chart, and plain sentences about what differs ("B returned 5.2 points a year more than A, with 11.0 points more volatility"). The sentences are produced by a small tested function from the figures, not by the AI.

**29.2 Overlap is money, and the page also shows the hidden link.** Final. Who: Me.
Overlap is the sum, over companies both portfolios hold, of the smaller of the two weights, so it reads as "60% of the money is in companies both hold". Because two portfolios can share nothing and still move together through shared economic forces, the page also shows the correlation of their daily returns and each one's biggest force.

**29.3 "Better" describes the past only.** Final. Who: Me.
Green marks the better value in each row, and the page says that is a description of this period, not advice on which to own. Tests recompute every number from the returned curves, and the real-data suite checks that tech is bumpier and higher-beta than the defensive sample.

### Mistakes in this slice

- Two of my page tests assumed the portfolio list was in creation order; it is newest first, so the default choice was not the pair I expected. The tests now choose explicitly.

---

## 30. Pooled spillover test with stricter checks (added 2026-10-25)

**30.1 One test over every large company.** Final. Who: Me.
The Reactions page now has an "All large companies pooled" card above the single-company one. It combines the last 12 earnings days of each eligible bellwether (11 on real data, 119 days) into one test of the question from section 26. The math is `pooledSpillover` in `packages/finance`; the service reuses the same per-event collection as the single-company test, so the two cannot drift apart.

**30.2 Events in the same week count once.** Final. Who: Me.
Section 26 admitted that earnings days are not independent: companies report in clumps, and the whole market moves on the same days. I group events by calendar week and average inside each week before working out the t-statistic. Real result: 119 days collapse to 70 independent weeks, and the sector-adjusted t goes from 3.9 to 4.1, so the clustering did not weaken the finding. Calendar week is a coarse stand-in for "same market conditions"; it is not a full cluster-robust covariance.

**30.3 A placebo.** Final. Who: Me.
Inside every event, the similarity scores are reshuffled among the stocks (200 times, seeded) and the pooled correlation is recomputed. The p-value is the share of shuffled runs that did at least as well as the real one, with a +1 correction, so with 200 runs the smallest possible value is 0.005. Real result: shuffled runs average 0.000 with a spread of 0.004, against a real mean of +0.056 raw and +0.041 sector-adjusted, so p = 0.005 for both. This shows the link between a stock's similarity score and its move is not luck of the draw; it does not show the scores are right, only that they carry information.

**30.4 What this does not show.** Final. Who: Me.
The effect is small: the average gap between the most-similar and least-similar fifth of stocks is 0.28 percentage points on the event day. The exposure scores are AI drafts. The test says the scores carry information about real moves, not that a portfolio built on them would earn more. The page says so in its "How the pooled test works" note, and the verdict is worded to match: it claims a finding only when the clustered sector-adjusted t is at least 2 and the placebo p is below 0.05.

**30.5 A shared cache.** Final. Who: Me.
The pooled request reads every bellwether's earnings days (about 5 seconds on real data), so the route keeps one result for 10 minutes.

### Mistakes in this slice

- My new help text repeated the title of the existing card as a phrase, which broke a browser test that looks that title up by text. I reworded the help text instead of loosening the test.
- `pnpm test` had been failing in `apps/web` because the unit runner picked up the real-data browser tests under `e2e-real/`; they are now excluded like `e2e/`.
- The real-data sample test timed out once when run straight after the heavier tests (it needs about 50 seconds alone). Its time limit is now generous.
- The README quoted "121 earnings days"; the window moves with the date and the count is now 119. The README states the current figures.

---

## 31. What the forces did (added 2026-10-25)

**31.1 Estimate each force's real daily return.** Final. Who: Me.
New page "What the forces did". Each day, every profiled stock's return is regressed on its exposure scores (a cross-sectional regression, the Fama-MacBeth method); each coefficient is that force's return for the day. Analogy: line up everyone in a school by how much they like sport, and see how much faster the sporty ones ran that day; that gap is "the sport force". The math is `crossSectionFit` and `attributeToFactors` in `packages/finance/src/factorreturns.ts`; the service is `server/forces.ts`.

**31.2 A small ridge, with an unpenalised intercept.** Final. Who: Me.
Forces that nearly always appear together (rates and growth, for instance) can produce wild offsetting coefficients, so a mild ridge penalty (1.0) is applied to the force columns but not to the intercept, which is the market-wide return of the day.

**31.3 The portfolio's return is split exactly.** Final. Who: Me.
Portfolio daily return = market-wide part + sum of (net exposure x force return) + residual, where the residual is whatever is left, so the three always add up to the total of the portfolio's daily returns. The tests check that identity both in unit tests and on real data, and that the force rows add to the force total.

**31.4 A check on the exposure scores themselves.** Final. Who: Me.
The same daily regression is run with sector labels instead of exposure scores, and both report an adjusted R-squared (penalised for how many columns they use). On real data over 252 days and about 500 stocks: exposures explain 17.4% of the daily differences between stocks, sector labels 13.1%, and exposures did better on 66% of days. This is in-sample (fitted on the day it is measured on), and the scores are AI drafts, so it shows the scores carry market information, not that they are right.

**31.5 Needs at least 60 profiled companies.** Final. Who: Me.
With fewer than 60, a day's cross-section is too thin to estimate 12 forces, so the page says so instead of showing numbers. The fixture test database has ten, so the browser tests there cover the unavailable and missing-profile paths, and the real-data suite checks the numbers and the page.

### Mistakes in this slice

- The first version of the chart was marked hidden from screen readers, but Recharts makes the drawing focusable, which axe flagged as a serious accessibility error. It is now a labelled group, and the table below carries the same figures.
- My first window fetched 60 calendar days beyond the target, which gave 210 trading days, not 252. It now fetches enough calendar days.
- I had planned a daily briefing page and dropped it: the Dashboard already is one (ranked insights plus the day's move), so a second page would have repeated it.

---

## 32. Evidence page (added 2026-10-25)

**32.1 A page that tests the product's own claims.** Final. Who: Me.
Because the aim is to show the idea holds up, the "Evidence" page runs three tests on the loaded data and states each with a verdict, the figures and what it does not show: (1) do stocks with similar hidden exposures move together on earnings days (the pooled test, section 30); (2) do exposure scores describe stocks better than sector labels (section 31); (3) do earnings days move stocks by more than an ordinary day (the event study). Nothing on the page is written in advance; every sentence and number comes from the same calculations the other pages use, so changing the data can change the verdicts.

**32.2 The bars are written down and tested.** Final. Who: Me.
"Supported" means a stated bar was cleared, not that the idea is proven. Spillover: clustered sector-adjusted t at least 2 and placebo p below 0.05. Sectors: exposures explain more than sector labels and do better on at least 60% of days. Earnings: at least 15% of days move more than twice normal noise (about 5% would by chance), over at least 30 events. Below the thresholds the verdict is "Inconclusive" or "Not supported"; with too little data it says "Not enough data" rather than guessing. The bars are judgment calls; they are separate pure functions with unit tests so they can be changed in one place.

**32.3 Real result today.** Final. Who: Me.
All three are "Supported" on the real data (119 earnings days and 70 weeks, exposures 17.4% versus sectors 13.1%, a majority of earnings days unusual). The effect sizes are small and the exposure scores are AI drafts, which the caveats on the page say.

**32.4 Shared and cached.** Final. Who: Me.
It needs no session and no portfolio. It re-runs three studies, so the result is cached for 10 minutes; the cache for the pooled test moved into the spillover service so both pages share it. The force estimate was split out of the page service (`estimateForces`) so the same regressions serve both pages.

### Mistakes in this slice

- My navigation test lists had Evidence in a different position than the sidebar, and my first page test counted nested list items (the caveat bullets) as findings. Both were test mistakes, fixed.

---

## 33. Watchlist and alerts (added 2026-10-25)

**33.1 A short list per visitor, with alerts from fixed rules.** Final. Who: Me.
A new `watchlist_items` table (migration 0008) keeps up to 30 companies per anonymous session, independent of any portfolio. The Watchlist page shows each company's last price, 1-day, 5-day and 1-month moves, distance from its 52-week high, and how many relevant news stories appeared in the last 7 days (linking to the newest). Adding a company already on the list does nothing; removing one that is not listed does nothing; unknown tickers return 404; the 31st company returns a conflict.

**33.2 Alert rules are few, fixed and stated.** Final. Who: Me.
Four rules, in `packages/finance/src/watch.ts` with the thresholds in one place: the latest move is at least 2 times the stock's own normal daily swing (measured over the prior year, so a 3% move means more for a calm utility than for a volatile chip maker); a fall of at least 10% over 21 trading days; price within 3% of its 52-week low; price within 3% of its 52-week high. Each alert text states the figure that triggered it, and alerts describe what happened, not what to do. Users cannot yet set their own rules; that keeps the page simple and the behaviour testable, and is the obvious next step if it proves useful.

**33.3 It is a status board, not a notifier.** Final. Who: Me.
Alerts are computed when the page is opened. Nothing is sent by email or push, because that needs an account and a delivery service, which this project does not have.

**33.4 `pnpm real` now applies migrations on start.** Final. Who: Me.
A real-data database built before this feature lacked its table, which made the page fail with a server error. The launcher now runs the (repeatable) migrations first, as `pnpm demo` already did.

### Mistakes in this slice

- The new table was not in the existing real-data, demo and dev databases, so the real-data suite got server errors until I applied migration 0008 to them; that is what led to 33.4.
- Two of my unit tests built price series that were unrealistically smooth (a straight line has almost no day-to-day noise), which made an ordinary day look like a huge move. I gave them realistic wiggle.
- A leftover `cat > /tmp/x` in one of my shell commands waited for input and had to be killed. It created no file and changed nothing.

---

## 34. How far can the AI-drafted exposures be trusted? A blind gold set (added 2026-10-26)

**34.1 The 24 demo profiles in the real database were replaced by AI drafts.** Final. Who: Me.
The real-data database still held the hand-made demo profiles for 24 of the best-known companies (AAPL, MSFT, NVDA, JPM and others), because the drafting script skips any company that already has a profile. Those rows are made up and say so, but the real-data results in section 32.3 were computed partly on them. `pnpm data:exposures --replace-illustrative` now drafts companies whose current rows are all demo rows; the demo rows are closed, not deleted, and the draft becomes the next version. Reviewed and drafted rows are never touched. All 503 companies now have AI drafts. The section 32.3 figures predate this and are re-measured for the paper.

**34.2 The gold set: the 3 most traded companies in each sector.** Final. Who: Me.
`pnpm data:gold` picks 33 companies (11 sectors times 3) by median daily traded value over the last year, keeping one share class per issuer (GOOGL, not also GOOG), and writes them to `packages/shared/src/gold-set.ts`. There is no market capitalisation in the data, so traded value stands in for size and familiarity. Choosing the best-known companies makes hand scoring feasible and suits the study (participants recognise them), but they are probably the easiest companies for both the AI and a person, so agreement on them is likely an upper bound for the index. The same list is the study universe (section 21).

**34.3 Scored blind, stored apart.** Final. Who: Me.
Editing a draft anchors the editor on it, so agreement measured that way would be inflated. The Review page's "Gold set (score blind)" filter opens a gold company with the draft hidden; the reviewer adds the forces that matter from scratch. The scores go to a new `blind_reviews` table (migration 0009) exactly as given, with the draft version that was hidden, once per reviewer and company. The first blind save also becomes the company's reviewed profile; a second person's blind scores are kept for comparison but do not overwrite it. The app cannot stop a reviewer from opening the company page elsewhere, so the note on the editor asks them not to.

**34.4 Agreement is weighted kappa over every company-force cell.** Final. Who: Me.
Each company is compared on all 12 forces, an absent force counting as 0, on the signed scale from -3 to +3. The headline figure is Cohen's kappa with quadratic weights: 1 is perfect, 0 is what chance would give, a near miss (2 against 3) costs little and a sign error (-2 against +2) costs a lot. The 95% interval comes from resampling companies (2,000 seeded draws), so one company's forces stay together. Also reported: plain kappa for "does this force matter at all", direction agreement where both see a link, forces per company for each side (does the AI over-assign?), per-force breakdowns and, where two people scored the same company, person-against-person kappa as a ceiling. Raw exact agreement is reported but is inflated by the many cells both leave at 0.

**34.5 The bar.** Final. Who: Me.
The Evidence page adds a fourth finding. "Supported" needs kappa of at least 0.6 (the usual reading of "substantial") with the lower end of the interval at least 0.4; below 0.4 is "Not supported"; fewer than 10 blind companies is "Not enough data". The scores behind it download as CSV from `/api/evidence/agreement`.

### Mistakes in this slice

- The first gold-set pick contained both GOOGL and GOOG. I added the one-share-class rule.
- The e2e fixture stored its "AI-drafted" rows with source `manual`, so a blind score could find no draft to compare with. The fixture now uses `llm_seeded` for them.
- My first blind e2e test saved AMZN with a different confidence than the fixture, which changed a later stress-test result. The test now repeats the fixture's values exactly.

---

## 13. Mistakes made and fixed (for honesty)

- I miscounted the factor list as 34 when it was 31. Fixed in the doc.
- A broad text replacement briefly damaged two rows of the roadmap's risk table. Caught and restored.
- When undoing a deliberate test breakage I accidentally discarded my own uncommitted delete-portfolio code. Noticed at once and rewritten identically.
- Early versions of the grounding check missed numbers inside labels and the word "reducing". Both were found by tests and fixed.
- Several failing tests were my own wrong assumptions, not app bugs, such as the ordering of search results.
