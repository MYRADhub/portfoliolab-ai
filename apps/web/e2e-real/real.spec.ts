import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { REVIEW_TOKEN, realDatabaseUrl } from "./env";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const H = { "x-review-token": REVIEW_TOKEN };

let sql: ReturnType<typeof postgres>;
test.beforeAll(async () => {
  sql = postgres(realDatabaseUrl(), { max: 2, onnotice: () => undefined });
  const [{ n }] = (await sql`select count(*)::int as n from companies`) as unknown as {
    n: number;
  }[];
  test.skip(n < 500, "The real-data database is not built. Run pnpm real:seed first.");
});
test.afterAll(async () => {
  await sql?.end();
});

test.describe("real data integrity (database)", () => {
  test("the whole S&P 500 is loaded with long, clean price histories", async () => {
    const [c] = await sql`select count(*)::int as n from companies`;
    expect(c!.n).toBe(503);
    const hist =
      await sql`select company_id, count(*)::int as n, min(date) as first, max(date) as last from prices_daily group by company_id`;
    expect(hist.length).toBe(503);
    // almost every company has about five years of daily bars; recent listings may have fewer
    expect(hist.filter((h) => h.n >= 1000).length).toBeGreaterThanOrEqual(480);
    // prices are current within a week
    const newest = hist
      .map((h) => new Date(h.last as string | Date).toISOString().slice(0, 10))
      .sort()
      .at(-1)!;
    expect((Date.now() - Date.parse(newest)) / 86_400_000).toBeLessThan(10);
  });

  test("no non-positive prices, no duplicate days, and no absurd single-day moves", async () => {
    const [bad] =
      await sql`select count(*)::int as n from prices_daily where adj_close <= 0 or close <= 0`;
    expect(bad!.n).toBe(0);
    const [dup] =
      await sql`select count(*)::int as n from (select company_id, date from prices_daily group by 1, 2 having count(*) > 1) d`;
    expect(dup!.n).toBe(0);
    // split-adjusted series should not jump by more than 60% in a day except in a handful of genuine cases
    const jumps = await sql`
      select count(*)::int as n from (
        select adj_close / lag(adj_close) over (partition by company_id order by date) - 1 as r from prices_daily
      ) t where abs(r) > 0.6`;
    expect(jumps[0]!.n).toBeLessThan(40);
  });

  test("the S&P 500 benchmark is loaded and current", async () => {
    const [b] =
      await sql`select count(*)::int as n, max(date) as last from benchmark_prices where symbol = 'SPY'`;
    expect(b!.n).toBeGreaterThan(1200);
    expect((Date.now() - new Date(b!.last as string | Date).getTime()) / 86_400_000).toBeLessThan(
      10,
    );
  });

  test("SEC figures match well-known facts", async () => {
    const rows = await sql`
      select f.metric, f.value from fundamentals f join companies c on c.id = f.company_id
      where c.ticker = 'AAPL' and f.fiscal_year = 2025`;
    const by = Object.fromEntries(rows.map((r) => [r.metric, r.value as number]));
    expect(by.revenue).toBe(416_161_000_000); // Apple's fiscal 2025 revenue, as filed
    expect(by.eps_diluted).toBeCloseTo(7.46, 2);
    const [n] = await sql`select count(distinct company_id)::int as n from fundamentals`;
    expect(n!.n).toBeGreaterThanOrEqual(495);
  });

  test("earnings events are loaded, time-stamped and linked", async () => {
    const [e] = await sql`select count(*)::int as n from news_articles where provider = 'sec'`;
    expect(e!.n).toBeGreaterThan(5000);
    const [orphans] = await sql`
      select count(*)::int as n from news_articles a
      where a.provider = 'sec' and not exists (select 1 from news_company_links l where l.article_id = a.id)`;
    expect(orphans!.n).toBe(0);
    const [unclassified] = await sql`
      select count(*)::int as n from news_articles a
      where a.provider = 'sec' and not exists (select 1 from news_classifications k where k.article_id = a.id)`;
    expect(unclassified!.n).toBe(0);
  });

  test("every company has an exposure profile, none of them silently presented as reviewed", async () => {
    const [none] = await sql`
      select count(*)::int as n from companies c
      where not exists (select 1 from company_factor_exposures e where e.company_id = c.id and e.valid_to is null)`;
    expect(none!.n).toBe(0);
    const [mislabelled] = await sql`
      select count(*)::int as n from company_factor_exposures
      where valid_to is null and source = 'llm_seeded' and rationale not like 'AI-drafted, not reviewed:%'`;
    expect(mislabelled!.n).toBe(0);
    const [capped] =
      await sql`select count(*)::int as n from company_factor_exposures where source = 'llm_seeded' and confidence > 0.8`;
    expect(capped!.n).toBe(0);
  });
});

test.describe("real data through the API", () => {
  test("research page figures are plausible", async ({ request }) => {
    const b = (await (await request.get("/api/research/NVDA")).json()) as Json;
    expect(b.company.name).toBe("Nvidia");
    expect(b.prices.length).toBeGreaterThan(240);
    expect(b.stats.last).toBeGreaterThan(20);
    expect(b.stats.last).toBeLessThan(2000);
    expect(b.stats.volatility).toBeGreaterThan(0.2);
    expect(b.stats.volatility).toBeLessThan(0.9);
    expect(b.fundamentals.years.length).toBeGreaterThanOrEqual(4);
    const r = b.fundamentals.ratios;
    expect(r.netMargin).toBeGreaterThan(0.1);
    expect(r.priceToEarnings).toBeGreaterThan(5);
    expect(r.priceToEarnings).toBeLessThan(400);
    expect(b.peers.length).toBe(5);
    expect(b.exposures.length).toBeGreaterThan(0);
  });

  test("the event study ran on thousands of real earnings days and finds a famous collapse", async ({
    request,
  }) => {
    const b = (await (await request.get("/api/events")).json()) as Json;
    expect(b.universe).toBe(503);
    expect(b.eventsStudied).toBeGreaterThan(4000);
    const earnings = b.byType.find((t: Json) => t.slug === "earnings_release");
    expect(earnings.n).toBeGreaterThan(4000);
    const h1 = earnings.horizons.find((h: Json) => h.horizon === 1).stats;
    expect(Math.abs(h1.mean)).toBeLessThan(0.01); // good and bad surprises cancel on average
    expect(earnings.typicalMove).toBeGreaterThan(0.03);
    expect(earnings.typicalMove).toBeLessThan(0.08);
    // Centene withdrew its guidance on 2025-07-02 and fell by roughly 40%
    const cnc = b.reactions.find((r: Json) => r.ticker === "CNC" && r.eventDate === "2025-07-02");
    expect(cnc, "Centene's July 2025 collapse should be among the biggest reactions").toBeDefined();
    expect(cnc.ar0).toBeLessThan(-0.3);
  });

  test("the spillover test runs across the whole index and reports a sector-adjusted figure", async ({
    request,
  }) => {
    const b = (await (
      await request.get("/api/events/spillover?ticker=NVDA&events=6")
    ).json()) as Json;
    expect(b.events.length).toBeGreaterThanOrEqual(5);
    for (const e of b.events) {
      expect(e.stocks).toBeGreaterThan(400);
      expect(Math.abs(e.correlation)).toBeLessThan(0.6);
    }
    expect(b.summary).not.toBeNull();
    expect(b.partialSummary).not.toBeNull();
    const eligible = ((await (await request.get("/api/events/spillover")).json()) as Json)
      .eligible as string[];
    expect(eligible).toEqual(expect.arrayContaining(["NVDA", "AAPL", "MSFT"]));
  });

  test("the pooled spillover test finds a small, placebo-robust relationship", async ({
    request,
  }) => {
    const r = (await (await request.get("/api/events/spillover?pooled=1")).json()) as Json;
    expect(r.events).toBeGreaterThan(80);
    expect(r.clusters).toBeGreaterThan(40);
    expect(r.clusters).toBeLessThanOrEqual(r.events);
    expect(r.companies.length).toBeGreaterThanOrEqual(8);
    // clustering by week can only reduce the number of observations
    expect(r.clusteredPartial.n).toBe(r.clusters);
    expect(r.partialCorrelation.mean).toBeGreaterThan(0);
    expect(r.partialCorrelation.mean).toBeLessThan(0.2);
    expect(r.clusteredPartial.t).toBeGreaterThan(2);
    // shuffled scores centre on zero, far from the real figure
    expect(Math.abs(r.placebo.nullMean)).toBeLessThan(0.01);
    expect(r.placebo.pPartial).toBeLessThan(0.05);
  });

  test("what the forces did: parts add up exactly, and exposures describe stocks better than sectors", async ({
    request,
  }) => {
    const portfolios = await session(request);
    const tech = portfolios.find((p) => p.name.includes("Mega-cap tech"))!;
    const energy = portfolios.find((p) => p.name.includes("Energy and banks"))!;
    const get = async (id: string) =>
      (await (await request.get(`/api/portfolios/${id}/forces`)).json()) as Json;
    for (const p of [tech, energy]) {
      const f = await get(p.id);
      expect(f.available).toBe(true);
      expect(f.window.days).toBeGreaterThan(200);
      expect(f.universe.stocks).toBeGreaterThan(400);
      expect(f.forces.length).toBe(f.universe.forces);
      // the split of the portfolio's return is exact, and the force rows add to its force total
      const a = f.attribution;
      expect(a.forces + a.market + a.residual).toBeCloseTo(a.total, 9);
      const rows = (f.forces as Json[]).reduce((s, r) => s + r.contribution, 0);
      expect(rows).toBeCloseTo(a.forces, 9);
      // exposures explain more of the daily differences between stocks than sector labels do
      expect(f.fit.exposures).toBeGreaterThan(f.fit.sectors);
      expect(f.fit.daysExposuresBetter).toBeGreaterThan(0.5);
      for (const r of f.forces) {
        expect(Number.isFinite(r.cumulative)).toBe(true);
        expect(Math.abs(r.cumulative)).toBeLessThan(1.5);
      }
    }
    // the universe-wide force returns do not depend on the portfolio
    const [ft, fe] = [await get(tech.id), await get(energy.id)];
    const cum = (f: Json, slug: string) => f.forces.find((r: Json) => r.slug === slug).cumulative;
    expect(cum(ft, "oil_price")).toBeCloseTo(cum(fe, "oil_price"), 9);
    // oil matters to the energy sample and barely to tech
    const net = (f: Json, slug: string) => f.forces.find((r: Json) => r.slug === slug).portfolioNet;
    expect(net(fe, "oil_price")).toBeGreaterThan(net(ft, "oil_price"));
  });

  test("the evidence page reaches the verdicts the other pages' numbers imply", async ({
    request,
  }) => {
    const b = (await (await request.get("/api/evidence")).json()) as Json;
    const by = Object.fromEntries((b.findings as Json[]).map((f) => [f.id, f]));
    expect(by.spillover.verdict).toBe("supported");
    expect(by.sectors.verdict).toBe("supported");
    expect(by.earnings.verdict).toBe("supported");
    // the figures shown match the underlying endpoints
    const pooled = (await (await request.get("/api/events/spillover?pooled=1")).json()) as Json;
    expect(
      by.spillover.figures.find((x: Json) => x.label === "Earnings days pooled").value,
    ).toContain(String(pooled.events));
    for (const f of b.findings) expect(f.caveats.length).toBeGreaterThan(0);
  });

  test("the watchlist reports plausible figures for real companies", async ({ request }) => {
    expect((await request.post("/api/session")).status()).toBe(200);
    for (const t of ["AAPL", "NVDA", "XOM", "JPM"])
      expect((await request.post("/api/watchlist", { data: { ticker: t } })).status()).toBe(201);
    const w = (await (await request.get("/api/watchlist")).json()) as Json;
    expect(w.items.map((i: Json) => i.ticker)).toEqual(["AAPL", "NVDA", "XOM", "JPM"]);
    for (const i of w.items) {
      expect(i.signals).not.toBeNull();
      expect(i.signals.last).toBeGreaterThan(1);
      expect(Math.abs(i.signals.d1)).toBeLessThan(0.3);
      expect(i.signals.fromHigh).toBeLessThanOrEqual(0);
      expect(i.signals.fromLow).toBeGreaterThanOrEqual(0);
      expect(i.signals.high52).toBeGreaterThanOrEqual(i.signals.last);
      expect(i.signals.z1).not.toBeNull();
    }
    for (const a of w.alerts) expect(a.alert.text).toMatch(/\d/);
  });

  test("the review tool sees every company as drafted, illustrative or reviewed, none missing", async ({
    request,
  }) => {
    const s = (await (await request.get("/api/review/summary", { headers: H })).json()) as Json;
    expect(s.companies).toBe(503);
    expect(s.none).toBe(0);
    expect(s.draft).toBeGreaterThan(450);
    expect(s.draft + s.illustrative + s.reviewed).toBe(503);
  });
});

async function session(request: APIRequestContext) {
  expect((await request.post("/api/session")).status()).toBe(200);
  const r = await request.post("/api/samples");
  expect([200, 201]).toContain(r.status());
  const list = (await (await request.get("/api/portfolios")).json()) as {
    portfolios: { id: string; name: string }[];
  };
  expect(list.portfolios.length).toBeGreaterThanOrEqual(5);
  return list.portfolios;
}

test.describe("sample portfolios on real data", () => {
  test("every analysis returns finite, plausible numbers for every sample", async ({ request }) => {
    test.setTimeout(300_000); // about 50 s alone, but the real database is shared with whatever else is running
    const portfolios = await session(request);
    const finite = (v: unknown, path: string) => {
      if (typeof v === "number") expect(Number.isFinite(v), path).toBe(true);
      else if (Array.isArray(v)) v.forEach((x, i) => finite(x, `${path}[${i}]`));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) finite(x, `${path}.${k}`);
    };
    for (const p of portfolios) {
      for (const route of [
        "terminal",
        "exposures",
        "correlation",
        "insights",
        "rebalance",
        "simulation",
        "radar",
        "benchmark",
      ]) {
        const r = await request.get(`/api/portfolios/${p.id}/${route}`);
        expect(r.status(), `${p.name} ${route}`).toBe(200);
        finite(await r.json(), `${p.name}.${route}`);
      }
      const t = (await (await request.get(`/api/portfolios/${p.id}/terminal`)).json()) as Json;
      expect(t.risk.volatility, p.name).toBeGreaterThan(0.04);
      expect(t.risk.volatility, p.name).toBeLessThan(0.8);
      expect(t.risk.maxDrawdown, p.name).toBeLessThan(0);
      const x = (await (await request.get(`/api/portfolios/${p.id}/exposures`)).json()) as Json;
      expect(x.available, p.name).toBe(true);
    }
  });

  test("mega-cap tech tracks the market closely with a beta near or above one, defensive is calmer", async ({
    request,
  }) => {
    const portfolios = await session(request);
    const tech = portfolios.find((p) => /mega-cap tech/i.test(p.name))!;
    const b = (await (await request.get(`/api/portfolios/${tech.id}/benchmark`)).json()) as Json;
    expect(b.available).toBe(true);
    expect(b.stats.n).toBeGreaterThan(500);
    expect(b.stats.correlation).toBeGreaterThan(0.6);
    expect(b.stats.beta).toBeGreaterThan(0.8);
    expect(b.stats.beta).toBeLessThan(2.2);
    const def = portfolios.find((p) => /defensive/i.test(p.name))!;
    const d = (await (await request.get(`/api/portfolios/${def.id}/benchmark`)).json()) as Json;
    expect(d.stats.beta).toBeLessThan(b.stats.beta);
    expect(d.stats.downCapture).toBeLessThan(b.stats.downCapture);
  });

  test("comparing two real samples gives finite, consistent figures", async ({ request }) => {
    const portfolios = await session(request);
    const tech = portfolios.find((p) => /mega-cap tech/i.test(p.name))!;
    const def = portfolios.find((p) => /defensive/i.test(p.name))!;
    const c = (await (await request.get(`/api/compare?a=${tech.id}&b=${def.id}`)).json()) as Json;
    expect(c.window.tradingDays).toBeGreaterThan(500);
    expect(c.a.volatility).toBeGreaterThan(c.b.volatility); // tech is bumpier than staples
    expect(c.a.beta).toBeGreaterThan(c.b.beta);
    expect(c.correlation).toBeGreaterThan(-0.2);
    expect(c.correlation).toBeLessThan(0.95);
    expect(c.overlap.sharedWeight).toBeLessThan(0.5);
    expect(c.differences.length).toBeGreaterThanOrEqual(5);
  });

  test("stress, discovery and what-if work on real exposures", async ({ request }) => {
    const [first] = await session(request);
    const catalog = (await (
      await request.get(`/api/portfolios/${first!.id}/stress`)
    ).json()) as Json;
    expect(catalog.presets.length).toBeGreaterThanOrEqual(4);
    const r = (await (
      await request.post(`/api/portfolios/${first!.id}/stress`, { data: { preset: "rate-shock" } })
    ).json()) as Json;
    expect(r.touched).toBe(true);
    expect(Math.abs(r.portfolioImpact)).toBeLessThan(0.3);
    const d = (await (await request.get(`/api/portfolios/${first!.id}/discovery`)).json()) as Json;
    expect(d.candidates.length).toBe(10);
    expect(d.sectors.length).toBeGreaterThan(5);
    const w = (await (
      await request.get(`/api/portfolios/${first!.id}/whatif?ticker=JNJ&weight=0.1`)
    ).json()) as Json;
    expect(w.available).toBe(true);
  });
});

async function visit(page: Page, path: string) {
  await page.goto(path);
  // Recharts tooltips also carry role="status", so wait specifically for the loading placeholder to go.
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("[role=status]")].some(
        (e) => e.textContent?.trim() === "Loading",
      ),
    null,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(500);
}

test.describe("pages with real data", () => {
  test("no page shows NaN, Infinity or undefined, and none throws", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto("/dashboard");
    await expect
      .poll(async () => (await page.context().cookies()).some((c) => c.name === "pl_session"))
      .toBe(true);
    expect((await page.request.post("/api/samples")).ok()).toBe(true);
    for (const path of [
      "/dashboard",
      "/terminal",
      "/exposures",
      "/correlation",
      "/news",
      "/events",
      "/stress",
      "/discovery",
      "/rebalance",
      "/benchmark",
      "/forces",
      "/evidence",
      "/watchlist",
      "/compare",
      "/report",
      "/simulation",
      "/research",
      "/research/NVDA",
      "/research/JPM",
    ]) {
      await visit(page, path);
      const text = await page.locator("main").innerText();
      for (const bad of ["NaN", "Infinity", "undefined", "[object Object]"])
        expect(text, `${path} shows ${bad}`).not.toContain(bad);
    }
    expect(errors).toEqual([]);
  });

  test("the forces page shows the split and the comparison with sectors, accessibly", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect
      .poll(async () => (await page.context().cookies()).some((c) => c.name === "pl_session"))
      .toBe(true);
    expect((await page.request.post("/api/samples")).ok()).toBe(true);
    await page.goto("/forces");
    await expect(page.getByTestId("forces-summary")).toContainText("trading days", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("forces-fit")).toContainText("sector labels alone");
    await expect(
      page.getByRole("table", { name: "What each force did" }).locator("tbody tr"),
    ).toHaveCount(12);
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(r.violations).toEqual([]);
  });

  test("the exposure page is honest about drafts, and the company page shows SEC figures", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect
      .poll(async () => (await page.context().cookies()).some((c) => c.name === "pl_session"))
      .toBe(true);
    await page.request.post("/api/samples");
    await visit(page, "/exposures");
    // The sample portfolios hold the 24 companies with hand-made illustrative profiles, and the page must say so.
    await expect(page.getByRole("note")).toContainText("illustrative placeholders");
    await visit(page, "/research/AAPL");
    await expect(page.getByRole("table", { name: "Annual figures" })).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Annual figures" }).getByRole("row", { name: /Revenue/ }),
    ).toContainText("$416.2B");
  });

  test("the Reactions page shows the real study", async ({ page }) => {
    await visit(page, "/events");
    const table = page.getByRole("table", { name: "Average reaction by event type" });
    await expect(table).toContainText("Earnings release");
    await expect(page.getByTestId("events-summary")).toContainText("story-stock pairs studied");
    await expect(
      page.getByRole("list", { name: "Reactions" }).getByRole("listitem").first(),
    ).toBeVisible();
    await page.getByLabel("Company reporting earnings").waitFor({ timeout: 60_000 });
    await expect(page.getByTestId("spillover-verdict")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("pooled-verdict")).toContainText("Pooled across companies", {
      timeout: 90_000,
    });
  });
});
