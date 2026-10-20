import { expect, test } from "@playwright/test";
import {
  BASE,
  COVERED,
  EXAMPLE,
  createPortfolio,
  mock,
  newSession,
  uniqueHoldings,
} from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe("health, ids and sessions", () => {
  test("health responds ok with a request id", async ({ request }) => {
    const r = await request.get("/api/health");
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
    expect(r.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("an incoming request id is echoed in the header and the error body", async ({ request }) => {
    const r = await request.get("/api/portfolios", { headers: { "x-request-id": "e2e-abc-123" } });
    expect(r.status()).toBe(401);
    expect(r.headers()["x-request-id"]).toBe("e2e-abc-123");
    expect(((await r.json()) as Json).error.requestId).toBe("e2e-abc-123");
  });

  test("creating a session sets a hardened cookie, and repeat calls reuse it", async ({
    playwright,
  }) => {
    const ctx = await playwright.request.newContext({ baseURL: BASE });
    const first = await ctx.post("/api/session");
    expect(await first.json()).toEqual({ created: true });
    const setCookie = first.headers()["set-cookie"]!;
    expect(setCookie).toMatch(/pl_session=[0-9a-f-]{36}/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/;\s*Secure/i); // served over plain http
    expect(await (await ctx.post("/api/session")).json()).toEqual({ created: false });
  });

  test("a secure cookie is set when the request arrives through an https proxy", async ({
    request,
  }) => {
    const r = await request.post("/api/session", { headers: { "x-forwarded-proto": "https" } });
    expect(r.headers()["set-cookie"]).toMatch(/;\s*Secure/i);
  });

  test("malformed or unknown session cookies are replaced", async ({ request }) => {
    for (const bad of [
      "pl_session=not-a-uuid",
      "pl_session=00000000-0000-4000-8000-000000000000",
    ]) {
      const r = await request.post("/api/session", { headers: { cookie: bad } });
      expect(await r.json()).toEqual({ created: true });
    }
  });

  test("session-protected routes return 401 with the standard error shape", async ({ request }) => {
    for (const [method, path] of [
      ["get", "/api/portfolios"],
      ["post", "/api/portfolios"],
      ["get", "/api/portfolios/00000000-0000-4000-8000-000000000000/analytics"],
      ["post", "/api/portfolios/00000000-0000-4000-8000-000000000000/explain"],
      ["delete", "/api/portfolios/00000000-0000-4000-8000-000000000000"],
    ] as const) {
      const r = await request[method](path);
      expect(r.status(), `${method} ${path}`).toBe(401);
      const body = (await r.json()) as Json;
      expect(body.error).toMatchObject({ code: "unauthorized", message: "No active session" });
      expect(body.error.requestId).toBeTruthy();
    }
  });

  test("unsupported methods are rejected", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "M", EXAMPLE);
    expect((await ctx.put("/api/portfolios", { data: {} })).status()).toBe(405);
    expect((await ctx.get(`/api/portfolios/${id}`)).status()).toBe(405);
    expect((await ctx.post(`/api/portfolios/${id}/analytics`)).status()).toBe(405);
  });
});

test.describe("company search", () => {
  test("matches ticker prefixes first, then names, case-insensitively", async ({ request }) => {
    const ms = ((await (await request.get("/api/companies?q=ms")).json()) as Json).companies;
    // An exact ticker match ranks ahead of longer prefix matches.
    expect(ms[0].ticker).toBe("MS");
    expect(ms.map((c: Json) => c.ticker)).toContain("MSFT");
    const nvda = ((await (await request.get("/api/companies?q=nVd")).json()) as Json).companies;
    expect(nvda.map((c: Json) => c.ticker)).toContain("NVDA");
    const byName = ((await (await request.get("/api/companies?q=micro")).json()) as Json).companies;
    expect(byName.map((c: Json) => c.ticker)).toContain("MSFT");
    expect(byName[0]).toMatchObject({ name: expect.any(String), sector: expect.any(String) });
  });

  test("handles empty, wildcard, long and unmatched queries safely, and caps results", async ({
    request,
  }) => {
    for (const q of ["", "%", "_", "%25%25", "zzzzzzzz", "a".repeat(500)]) {
      const r = await request.get(`/api/companies?q=${encodeURIComponent(q)}`);
      expect(r.status(), q.slice(0, 10)).toBe(200);
      expect(((await r.json()) as Json).companies).toEqual([]);
    }
    const many = ((await (await request.get("/api/companies?q=a")).json()) as Json).companies;
    expect(many.length).toBeGreaterThan(1);
    expect(many.length).toBeLessThanOrEqual(10);
  });
});

test.describe("portfolio creation validation", () => {
  const cases: [string, unknown, number, RegExp][] = [
    ["empty holdings", { name: "x", holdings: [] }, 400, /Invalid request/],
    ["missing name", { holdings: [{ ticker: "NVDA", weightPct: 100 }] }, 400, /Invalid request/],
    [
      "blank name",
      { name: "   ", holdings: [{ ticker: "NVDA", weightPct: 100 }] },
      400,
      /Invalid request/,
    ],
    [
      "name too long",
      { name: "x".repeat(81), holdings: [{ ticker: "NVDA", weightPct: 100 }] },
      400,
      /Invalid request/,
    ],
    [
      "weight as string",
      { name: "x", holdings: [{ ticker: "NVDA", weightPct: "100" }] },
      400,
      /Invalid request/,
    ],
    [
      "bad ticker characters",
      { name: "x", holdings: [{ ticker: "NV DA!", weightPct: 100 }] },
      400,
      /Invalid request/,
    ],
    [
      "weights not summing to 100",
      {
        name: "x",
        holdings: [
          { ticker: "NVDA", weightPct: 50 },
          { ticker: "AAPL", weightPct: 20 },
        ],
      },
      400,
      /sum to 70\.00%, expected 100%/,
    ],
    [
      "duplicate tickers",
      {
        name: "x",
        holdings: [
          { ticker: "NVDA", weightPct: 50 },
          { ticker: "nvda", weightPct: 50 },
        ],
      },
      400,
      /NVDA appears more than once/,
    ],
    [
      "zero weight",
      {
        name: "x",
        holdings: [
          { ticker: "NVDA", weightPct: 100 },
          { ticker: "AAPL", weightPct: 0 },
        ],
      },
      400,
      /AAPL must have a weight above 0/,
    ],
    [
      "negative weight",
      {
        name: "x",
        holdings: [
          { ticker: "NVDA", weightPct: 150 },
          { ticker: "AAPL", weightPct: -50 },
        ],
      },
      400,
      /AAPL must have a weight above 0/,
    ],
    [
      "unknown ticker",
      {
        name: "x",
        holdings: [
          { ticker: "NVDA", weightPct: 50 },
          { ticker: "ZZZZ", weightPct: 50 },
        ],
      },
      400,
      /Unknown tickers: ZZZZ/,
    ],
  ];
  for (const [name, body, status, message] of cases) {
    test(`rejects ${name}`, async ({ playwright }) => {
      const ctx = await newSession(playwright);
      const r = await ctx.post("/api/portfolios", { data: body });
      expect(r.status()).toBe(status);
      const err = ((await r.json()) as Json).error;
      expect(err.code).toBe("bad_request");
      expect(err.message).toMatch(message);
      expect(((await (await ctx.get("/api/portfolios")).json()) as Json).portfolios).toHaveLength(
        0,
      );
    });
  }

  test("rejects more than 50 holdings and non-JSON bodies", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const tickers = ((await (await ctx.get("/api/companies?q=a")).json()) as Json)
      .companies as Json[];
    expect(tickers.length).toBeGreaterThan(0);
    const fifty1 = Array.from({ length: 51 }, (_, i) => ({ ticker: `T${i}`, weightPct: 100 / 51 }));
    expect(
      (await ctx.post("/api/portfolios", { data: { name: "big", holdings: fifty1 } })).status(),
    ).toBe(400);
    const r = await ctx.post("/api/portfolios", {
      headers: { "content-type": "application/json" },
      data: Buffer.from("{not json"),
    });
    expect(r.status()).toBe(400);
    expect(((await r.json()) as Json).error.message).toBe("Body must be valid JSON");
  });

  test("accepts lowercase tickers and rescales when asked", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const r = await ctx.post("/api/portfolios", {
      data: {
        name: "Rescaled",
        normalize: true,
        holdings: [
          { ticker: "nvda", weightPct: 1 },
          { ticker: "aapl", weightPct: 3 },
        ],
      },
    });
    expect(r.status()).toBe(201);
    const id = ((await r.json()) as Json).portfolio.id;
    const a = (await (await ctx.get(`/api/portfolios/${id}/analytics`)).json()) as Json;
    expect(a.holdings.map((h: Json) => [h.ticker, h.weight])).toEqual([
      ["AAPL", 0.75],
      ["NVDA", 0.25],
    ]);
  });

  test("rejects non-positive weights even when rescaling", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const r = await ctx.post("/api/portfolios", {
      data: {
        name: "x",
        normalize: true,
        holdings: [
          { ticker: "NVDA", weightPct: 5 },
          { ticker: "AAPL", weightPct: -1 },
        ],
      },
    });
    expect(r.status()).toBe(400);
  });

  test("lists portfolios newest first", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    await createPortfolio(ctx, "First", EXAMPLE);
    await new Promise((r) => setTimeout(r, 20));
    await createPortfolio(ctx, "Second", COVERED);
    const list = ((await (await ctx.get("/api/portfolios")).json()) as Json).portfolios;
    expect(list.map((p: Json) => p.name)).toEqual(["Second", "First"]);
  });

  test("handles simultaneous creates without cross-contamination", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const ids = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createPortfolio(ctx, `Parallel ${i}`, i % 2 ? EXAMPLE : COVERED),
      ),
    );
    expect(new Set(ids).size).toBe(6);
    for (const [i, id] of ids.entries()) {
      const a = (await (await ctx.get(`/api/portfolios/${id}/analytics`)).json()) as Json;
      expect(a.holdings).toHaveLength(i % 2 ? 5 : 4);
    }
  });
});

test.describe("analytics", () => {
  test("returns a coherent, internally consistent result", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "A", EXAMPLE);
    const r = await ctx.get(`/api/portfolios/${id}/analytics`);
    expect(r.status()).toBe(200);
    const a = (await r.json()) as Json;
    expect(a.portfolio).toEqual({ id, name: "A" });
    expect(a.window.tradingDays).toBeGreaterThan(240);
    expect(a.equityCurve).toHaveLength(a.window.tradingDays);
    expect(a.drawdown).toHaveLength(a.window.tradingDays);
    expect(a.equityCurve[0].value).toBe(1);
    expect(a.equityCurve.at(-1).value - 1).toBeCloseTo(a.stats.totalReturn, 10);
    expect(Math.min(...a.drawdown.map((d: Json) => d.value))).toBeCloseTo(a.stats.maxDrawdown, 12);
    expect(a.sectors.reduce((s: number, x: Json) => s + x.weight, 0)).toBeCloseTo(1, 12);
    expect(a.holdings.reduce((s: number, h: Json) => s + h.weight, 0)).toBeCloseTo(1, 12);
    expect(a.concentration.hhi).toBeCloseTo(0.25 ** 2 + 0.2 ** 2 * 3 + 0.15 ** 2, 12);
    expect(a.concentration.topWeight).toBe(0.25);
    expect(a.stats.annualizedVolatility).toBeGreaterThan(0);
    expect(a.stats.riskFreeAnnual).toBe(0);
    const dates = a.equityCurve.map((p: Json) => p.date);
    expect([...dates].sort()).toEqual(dates);
  });

  test("the years parameter changes the window and is validated", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Y", EXAMPLE);
    const one = (await (await ctx.get(`/api/portfolios/${id}/analytics?years=1`)).json()) as Json;
    const three = (await (await ctx.get(`/api/portfolios/${id}/analytics?years=3`)).json()) as Json;
    expect(three.window.tradingDays).toBeGreaterThan(one.window.tradingDays * 2);
    for (const bad of ["0", "6", "abc", "1.5", "-1"]) {
      expect((await ctx.get(`/api/portfolios/${id}/analytics?years=${bad}`)).status(), bad).toBe(
        400,
      );
    }
  });

  test("validates ids and reports unknown portfolios", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    expect((await ctx.get("/api/portfolios/not-a-uuid/analytics")).status()).toBe(400);
    const r = await ctx.get("/api/portfolios/00000000-0000-4000-8000-000000000000/analytics");
    expect(r.status()).toBe(404);
    expect(((await r.json()) as Json).error.code).toBe("not_found");
  });

  test("explains why a portfolio cannot be analyzed", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const short = await createPortfolio(ctx, "Short", [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "TGT", weightPct: 50 },
    ]);
    const r1 = await ctx.get(`/api/portfolios/${short}/analytics`);
    expect(r1.status()).toBe(409);
    expect(((await r1.json()) as Json).error.message).toMatch(
      /Only \d+ trading days of shared history; at least 30 are required/,
    );
    const none = await createPortfolio(ctx, "None", [
      { ticker: "NVDA", weightPct: 50 },
      { ticker: "GOOGL", weightPct: 50 },
    ]);
    const r2 = await ctx.get(`/api/portfolios/${none}/analytics`);
    expect(r2.status()).toBe(409);
    expect(((await r2.json()) as Json).error.message).toBe("No price history yet for: GOOGL");
  });
});

test.describe("correlation", () => {
  test("returns a valid symmetric matrix for each window, with shorter windows covering fewer days", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "C", EXAMPLE);
    const days: Record<string, number> = {};
    for (const w of ["6m", "1y", "3y"]) {
      const c = (await (
        await ctx.get(`/api/portfolios/${id}/correlation?window=${w}`)
      ).json()) as Json;
      days[w] = c.window.tradingDays;
      expect(c.tickers).toEqual(["AAPL", "AMZN", "JPM", "MSFT", "NVDA"]);
      for (let i = 0; i < 5; i++) {
        expect(c.matrix[i][i]).toBe(1);
        for (let j = 0; j < 5; j++) {
          expect(c.matrix[i][j]).toBeCloseTo(c.matrix[j][i], 12);
          expect(Math.abs(c.matrix[i][j])).toBeLessThanOrEqual(1);
        }
      }
      expect([...c.order].sort()).toEqual([0, 1, 2, 3, 4]);
      expect(c.pairs).toHaveLength(10);
      expect(c.pairs.map((p: Json) => p.correlation)).toEqual(
        [...c.pairs.map((p: Json) => p.correlation)].sort((a: number, b: number) => b - a),
      );
      expect(c.diversificationRatio).toBeGreaterThanOrEqual(1);
      expect(c.withPortfolio).toHaveLength(5);
    }
    expect(days["6m"]).toBeLessThan(days["1y"]!);
    expect(days["1y"]).toBeLessThan(days["3y"]!);
  });

  test("defaults to one year and validates the window", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "C", EXAMPLE);
    expect(
      ((await (await ctx.get(`/api/portfolios/${id}/correlation`)).json()) as Json).window.label,
    ).toBe("1y");
    expect((await ctx.get(`/api/portfolios/${id}/correlation?window=9y`)).status()).toBe(400);
  });

  test("needs at least two holdings", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "One", [{ ticker: "NVDA", weightPct: 100 }]);
    const r = await ctx.get(`/api/portfolios/${id}/correlation`);
    expect(r.status()).toBe(400);
    expect(((await r.json()) as Json).error.message).toBe("Correlation needs at least 2 holdings");
  });
});

test.describe("exposures", () => {
  test("reports when no exposure data exists for the holdings", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "X", [
      { ticker: "XOM", weightPct: 60 },
      { ticker: "JPM", weightPct: 40 },
    ]);
    const x = (await (await ctx.get(`/api/portfolios/${id}/exposures`)).json()) as Json;
    expect(x).toMatchObject({ available: false, reason: "no_factors" });
  });

  test("refuses partial coverage and names the missing tickers", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "P", EXAMPLE); // JPM has no exposures
    const x = (await (await ctx.get(`/api/portfolios/${id}/exposures`)).json()) as Json;
    expect(x).toEqual({ available: false, reason: "missing_exposures", missingTickers: ["JPM"] });
  });

  test("computes loadings, factor HHI and sector HHI that match an independent calculation", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Covered", COVERED);
    const x = (await (await ctx.get(`/api/portfolios/${id}/exposures`)).json()) as Json;
    expect(x.available).toBe(true);

    const w = { NVDA: 0.4, AAPL: 0.3, MSFT: 0.2, AMZN: 0.1 };
    const signed: Record<string, Record<string, number>> = {
      NVDA: { ai_capex: 3, taiwan: -3, china: 2, rates: -1 },
      AAPL: { taiwan: -2, china: 2, consumer: 3, rates: -1 },
      MSFT: { ai_capex: 2, rates: -1 },
      AMZN: { consumer: 3, ai_capex: 1, rates: -2 },
    };
    const net: Record<string, number> = {};
    for (const [t, ex] of Object.entries(signed))
      for (const [f, v] of Object.entries(ex)) net[f] = (net[f] ?? 0) + w[t as keyof typeof w] * v;
    const total = Object.values(net).reduce((a, b) => a + Math.abs(b), 0);
    const hhi = Object.values(net).reduce((a, b) => a + (Math.abs(b) / total) ** 2, 0);

    for (const f of x.factors) expect(f.net).toBeCloseTo(net[f.slug]!, 12);
    expect(x.concentration.factorHhi).toBeCloseTo(hhi, 12);
    expect(x.concentration.effectiveFactors).toBeCloseTo(1 / hhi, 10);
    expect(x.concentration.topFactorShare).toBeCloseTo(
      Math.max(...Object.values(net).map(Math.abs)) / total,
      12,
    );
    // Sectors: NVDA, AAPL, MSFT are Information Technology (0.9), AMZN Consumer Discretionary (0.1).
    expect(x.concentration.sectorHhi).toBeCloseTo(0.9 ** 2 + 0.1 ** 2, 12);
    expect(x.pairs).toHaveLength(6);
    const shares = x.factors.reduce((s: number, f: Json) => s + f.share, 0);
    expect(shares).toBeCloseTo(1, 12);
    expect(x.cells).toHaveLength(13);
    expect(
      x.cells.every(
        (c: Json) => c.rationale === "e2e fixture, not real data" && c.confidence === 0.8,
      ),
    ).toBe(true);
  });
});

test.describe("session isolation and deletion", () => {
  test("one session cannot read, analyze, explain or delete another session's portfolio", async ({
    playwright,
  }) => {
    const owner = await newSession(playwright);
    const intruder = await newSession(playwright);
    const id = await createPortfolio(owner, "Private", EXAMPLE);
    expect(((await (await intruder.get("/api/portfolios")).json()) as Json).portfolios).toEqual([]);
    for (const path of ["analytics", "correlation", "exposures"]) {
      const r = await intruder.get(`/api/portfolios/${id}/${path}`);
      expect(r.status(), path).toBe(404);
    }
    expect((await intruder.post(`/api/portfolios/${id}/explain`)).status()).toBe(404);
    expect((await intruder.delete(`/api/portfolios/${id}`)).status()).toBe(404);
    expect((await owner.get(`/api/portfolios/${id}/analytics`)).status()).toBe(200);
  });

  test("deleting removes the portfolio and is not repeatable", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Temp", EXAMPLE);
    const del = await ctx.delete(`/api/portfolios/${id}`);
    expect(del.status()).toBe(204);
    expect(await del.text()).toBe("");
    expect(((await (await ctx.get("/api/portfolios")).json()) as Json).portfolios).toEqual([]);
    expect((await ctx.get(`/api/portfolios/${id}/analytics`)).status()).toBe(404);
    expect((await ctx.delete(`/api/portfolios/${id}`)).status()).toBe(404);
    expect((await ctx.delete("/api/portfolios/not-a-uuid")).status()).toBe(400);
  });
});

test.describe("explanations (mock OpenAI)", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("returns a grounded explanation whose figures match the analytics, then serves repeats from cache", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const holdings = uniqueHoldings();
    const id = await createPortfolio(ctx, "E", holdings);
    const r = await ctx.post(`/api/portfolios/${id}/explain`);
    expect(r.status()).toBe(200);
    const body = (await r.json()) as Json;
    expect(body.cached).toBe(false);
    expect(body.explanation).toMatchObject({
      source: "model",
      issues: [],
      promptVersion: "exp-v1",
    });
    expect(body.disclaimer).toMatch(/not investment advice/);

    const a = (await (await ctx.get(`/api/portfolios/${id}/analytics`)).json()) as Json;
    const fact = (label: string) => body.facts.find((f: Json) => f.label === label)?.text;
    const signed = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
    expect(fact("Total return")).toBe(signed(a.stats.totalReturn));
    expect(fact("Annualized volatility")).toBe(
      `${(a.stats.annualizedVolatility * 100).toFixed(1)}%`,
    );
    expect(fact("Maximum drawdown")).toBe(`${(a.stats.maxDrawdown * 100).toFixed(1)}%`);
    expect(fact("Sharpe ratio")).toBe(a.stats.sharpe.toFixed(2));
    expect(fact("Number of holdings")).toBe("2 holdings");
    expect(body.facts.map((f: Json) => f.id)).toEqual(
      body.facts.map((_: unknown, i: number) => `F${i + 1}`),
    );

    const reqs = await mock.requests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.auth).toBe("Bearer test-key");
    expect(reqs[0]!.model).toBe("gpt-6-sol");
    expect(reqs[0]!.instructions).toMatch(/Never tell the reader to buy, sell, hold/);
    expect(reqs[0]!.input).toContain("<facts>");
    expect(reqs[0]!.input).toContain(`Total return: ${fact("Total return")}`);

    const again = (await (await ctx.post(`/api/portfolios/${id}/explain`)).json()) as Json;
    expect(again.cached).toBe(true);
    expect(again.explanation.summary).toBe(body.explanation.summary);
    expect(await mock.requests()).toHaveLength(1);
  });

  test("an ungrounded answer is retried once, then replaced by the fallback and never cached", async ({
    playwright,
  }) => {
    await mock.setMode("ungrounded");
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "U", uniqueHoldings());
    const body = (await (await ctx.post(`/api/portfolios/${id}/explain`)).json()) as Json;
    expect(body.explanation.source).toBe("fallback");
    expect(body.explanation.issues).toEqual([{ kind: "ungrounded_number", detail: "99.99" }]);
    expect(JSON.stringify(body.explanation)).not.toContain("99.99%");
    expect(body.explanation.highlights[0]).toMatch(/^Analysis window: .* \[F1\]$/);
    expect(await mock.requests()).toHaveLength(2);
    const second = (await (await ctx.post(`/api/portfolios/${id}/explain`)).json()) as Json;
    expect(second.cached).toBe(false);
    expect(await mock.requests()).toHaveLength(4);
  });

  test("a rejected first answer is corrected on the retry, which tells the model what was wrong", async ({
    playwright,
  }) => {
    await mock.setMode("retry");
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "R", uniqueHoldings());
    const body = (await (await ctx.post(`/api/portfolios/${id}/explain`)).json()) as Json;
    expect(body.explanation.source).toBe("model");
    const reqs = await mock.requests();
    expect(reqs).toHaveLength(2);
    expect(reqs[0]!.input).not.toContain("rejected");
    expect(reqs[1]!.input).toContain("ungrounded_number (99.99)");
  });

  test("refusals, incomplete outputs and upstream errors degrade safely", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    for (const mode of ["refusal", "incomplete"] as const) {
      await mock.setMode(mode);
      const id = await createPortfolio(ctx, mode, uniqueHoldings());
      const body = (await (await ctx.post(`/api/portfolios/${id}/explain`)).json()) as Json;
      expect(body.explanation.source, mode).toBe("fallback");
    }
    await mock.setMode("error");
    const id = await createPortfolio(ctx, "err", uniqueHoldings());
    const r = await ctx.post(`/api/portfolios/${id}/explain`);
    expect(r.status()).toBe(500);
    const err = ((await r.json()) as Json).error;
    expect(err).toMatchObject({ code: "internal", message: "Something went wrong" });
    expect(JSON.stringify(err)).not.toContain("mock upstream failure");
  });

  test("includes exposure facts when the holdings are covered", async ({ playwright }) => {
    const ctx = await newSession(playwright);
    const id = await createPortfolio(ctx, "Cov", [
      { ticker: "NVDA", weightPct: 41.3 },
      { ticker: "AAPL", weightPct: 30.1 },
      { ticker: "MSFT", weightPct: 18.6 },
      { ticker: "AMZN", weightPct: 10 },
    ]);
    const body = (await (await ctx.post(`/api/portfolios/${id}/explain`)).json()) as Json;
    const labels = body.facts.map((f: Json) => f.label);
    expect(labels).toContain("Effective number of economic factors");
    expect(labels).toContain("Largest economic factor");
    expect(labels).toContain("Average pairwise correlation (1 year)");
  });

  test("limits uncached explanations to 10 per hour per session but still serves cache hits", async ({
    playwright,
  }) => {
    const ctx = await newSession(playwright);
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push(await createPortfolio(ctx, `L${i}`, uniqueHoldings()));
    for (let i = 0; i < 10; i++)
      expect(
        (await ctx.post(`/api/portfolios/${ids[i]}/explain`)).status(),
        `request ${i + 1}`,
      ).toBe(200);
    const limited = await ctx.post(`/api/portfolios/${ids[10]}/explain`);
    expect(limited.status()).toBe(429);
    expect(((await limited.json()) as Json).error).toMatchObject({
      code: "rate_limited",
      message: "Too many explanation requests. Try again later.",
    });
    const hit = await ctx.post(`/api/portfolios/${ids[0]}/explain`);
    expect(hit.status()).toBe(200);
    expect(((await hit.json()) as Json).cached).toBe(true);
    // Another session has its own allowance.
    const other = await newSession(playwright);
    const oid = await createPortfolio(other, "Fresh", uniqueHoldings());
    expect((await other.post(`/api/portfolios/${oid}/explain`)).status()).toBe(200);
  });
});
