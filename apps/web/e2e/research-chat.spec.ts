import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { COVERED, mock, newSession, startUiSession } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Posts a research question and returns the status and, for a stream, its parsed events. */
async function askApi(req: APIRequestContext | Page["request"], data: object) {
  const r = await req.post("/api/research/chat", { data });
  const body = await r.text();
  const events = r.ok()
    ? body
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Json)
    : [];
  return { status: r.status(), events, body };
}

test.describe("research chat API", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("streams the thread, each tool, the check, and a stored verified answer", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const { status, events } = await askApi(page.request, {
      question: "How risky is my portfolio?",
      portfolioId: id,
    });
    expect(status).toBe(200);
    expect(events.map((e) => e.type)).toEqual([
      "thread",
      "tool_start",
      "tool_done",
      "checking",
      "answer",
    ]);
    expect(events[0]).toMatchObject({ created: true, title: "How risky is my portfolio?" });
    expect(events[1]).toMatchObject({ name: "get_portfolio_summary" });
    const answer = events.at(-1)!;
    expect(answer.disclaimer).toMatch(/not investment advice/);
    expect(answer.message.answer.source).toBe("model");
    expect(answer.message.answer.mode).toBe("quick");
    expect(answer.message.content).toMatch(/^## Findings/);

    const threadId = events[0]!.threadId;
    const t = (await (await page.request.get(`/api/research/threads/${threadId}`)).json()) as Json;
    expect(t.messages.map((m: Json) => m.role)).toEqual(["user", "assistant"]);
    expect(t.messages[1].answer.facts.length).toBeGreaterThan(3);
    const list = (await (await page.request.get("/api/research/threads")).json()) as Json;
    expect(list.threads.map((x: Json) => x.id)).toContain(threadId);

    // The research instructions, not the short portfolio ones, and portfolio tools only because one was chosen.
    const req = (await mock.requests()).find((r) => r.path === "/v1/responses")!;
    expect(req.instructions).toMatch(/research analyst/);
    expect(req.instructions).toMatch(/Answer in at most 300 words/);
  });

  test("a follow-up in the same thread carries the verified turn as context", async ({ page }) => {
    await startUiSession(page);
    const first = await askApi(page.request, { question: "Tell me about NVDA" });
    const threadId = first.events[0]!.threadId;
    const second = await askApi(page.request, { question: "And how volatile is it?", threadId });
    expect(second.events[0]).toMatchObject({ threadId, created: false });
    const last = (await mock.requests())
      .filter((r) => r.input.includes("And how volatile is it?"))
      .at(-1)!;
    expect(last.input).toContain("Earlier in this conversation");
    expect(last.input).toContain("Tell me about NVDA");
  });

  test("web search results become cited web sources with links", async ({ page }) => {
    await startUiSession(page);
    const { events } = await askApi(page.request, {
      question: "What does the web say about Mock Corp?",
    });
    const done = events.find((e) => e.type === "tool_done")!;
    expect(done.name).toBe("web_search");
    expect(done.facts[0]).toMatchObject({
      kind: "web",
      source: { url: "https://example.com/e2e-web-result" },
      text: "Mock Corp reported quarterly revenue of $12.3 billion, up 45% from a year ago.",
    });
    const msg = events.at(-1)!.message;
    expect(msg.answer.source).toBe("model");
    expect(msg.content).toContain("$12.3 billion");
    // The nested search went to the hosted tool with the query, separately from the main conversation.
    const ws = (await mock.requests()).find((r) => r.path === "/v1/responses#web_search")!;
    expect(ws.input).toContain("Mock Corp results");
  });

  test("a comparison offers a table that the answer shows", async ({ page }) => {
    await startUiSession(page);
    const { events } = await askApi(page.request, { question: "Compare these two please" });
    const msg = events.at(-1)!.message;
    expect(msg.answer.displays.map((d: Json) => d.kind)).toEqual([
      "table",
      "bar",
      "scatter",
      "heatmap",
    ]);
    expect(msg.answer.displays[0]).toMatchObject({ id: "D1", kind: "table", title: "Comparison" });
    expect(msg.answer.displays[0].rows.map((r: string[]) => r[0])).toEqual(["NVDA", "AAPL"]);
  });

  test("deep research uses the report instructions", async ({ page }) => {
    await startUiSession(page);
    const { events } = await askApi(page.request, {
      question: "Research brief on NVDA",
      mode: "deep",
    });
    expect(events.at(-1)!.message.answer.mode).toBe("deep");
    const req = (await mock.requests()).find((r) => r.path === "/v1/responses")!;
    expect(req.instructions).toMatch(/deep research request/);
  });

  test("an unverifiable answer is stored as a fallback without the invented number", async ({
    page,
  }) => {
    await mock.setMode("ungrounded");
    await startUiSession(page);
    const { events } = await askApi(page.request, { question: "Tell me about NVDA" });
    const msg = events.at(-1)!.message;
    expect(msg.answer.source).toBe("fallback");
    expect(msg.content).not.toContain("99.99");
    expect(events.some((e) => e.type === "retry")).toBe(true);
  });

  test("an upstream failure is reported in the stream and keeps the question", async ({ page }) => {
    await mock.setMode("error");
    await startUiSession(page);
    const { status, events } = await askApi(page.request, { question: "Tell me about NVDA" });
    expect(status).toBe(200);
    expect(events.at(-1)).toMatchObject({ type: "error" });
    const t = (await (
      await page.request.get(`/api/research/threads/${events[0]!.threadId}`)
    ).json()) as Json;
    expect(t.messages.map((m: Json) => m.role)).toEqual(["user"]);
  });

  test("validates input, ownership, and limits deep research per hour", async ({
    page,
    playwright,
  }) => {
    const s = await startUiSession(page);
    const pid = await s.create("Covered", COVERED);
    expect((await askApi(page.request, { question: "hi" })).status).toBe(400);
    expect((await askApi(page.request, { question: "x".repeat(2001) })).status).toBe(400);
    expect(
      (await askApi(page.request, { question: "Tell me about NVDA", mode: "huge" })).status,
    ).toBe(400);
    const { events } = await askApi(page.request, { question: "Tell me about NVDA" });
    const threadId = events[0]!.threadId;

    const other = await newSession(playwright);
    expect((await other.get(`/api/research/threads/${threadId}`)).status()).toBe(404);
    expect((await askApi(other, { question: "Tell me about NVDA", threadId })).status).toBe(404);
    expect((await askApi(other, { question: "Tell me about NVDA", portfolioId: pid })).status).toBe(
      404,
    );
    expect(((await (await other.get("/api/research/threads")).json()) as Json).threads).toEqual([]);
    expect((await other.delete(`/api/research/threads/${threadId}`)).status()).toBe(404);

    for (let i = 0; i < 6; i++)
      expect(
        (await askApi(other, { question: `Deep question ${i} on NVDA`, mode: "deep" })).status,
      ).toBe(200);
    const limited = await askApi(other, { question: "One more deep NVDA", mode: "deep" });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatch(/Deep research is limited to 6/);
    // Quick questions have their own allowance.
    expect((await askApi(other, { question: "Quick NVDA question" })).status).toBe(200);

    expect((await page.request.delete(`/api/research/threads/${threadId}`)).status()).toBe(204);
    expect((await page.request.get(`/api/research/threads/${threadId}`)).status()).toBe(404);
  });
});

test.describe("research chat page", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("a suggested question gets a cited answer with sources, and the thread is listed", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/research");
    await page.getByRole("button", { name: "What is the biggest risk in my portfolio?" }).click();
    const answer = page.getByRole("region", { name: "Assistant answer" });
    await expect(answer.getByRole("heading", { name: "Findings" })).toBeVisible();
    await expect(answer.getByRole("link", { name: "F1", exact: true }).first()).toBeVisible();
    await answer.getByText(/Sources and figures/).click();
    await expect(answer.getByText("Our data")).toBeVisible();
    await expect(page.getByText(/not investment advice/)).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Conversations" }).first().getByRole("button", {
        name: "What is the biggest risk in my portfolio?",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("shows progress, keeps the conversation, and reopens it after a reload", async ({
    page,
  }) => {
    await startUiSession(page);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("Tell me about NVDA");
    await page.getByLabel("Your question").press("Enter");
    await expect(page.getByRole("region", { name: "Assistant answer" })).toContainText(
      "NVDA sector",
    );
    await expect(page.getByText("Reading the NVDA profile")).toHaveCount(0);
    await page.getByLabel("Your question").fill("And how volatile is NVDA?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toHaveCount(2);

    await page.reload();
    await page
      .getByRole("navigation", { name: "Conversations" })
      .first()
      .getByRole("button", { name: "Tell me about NVDA", exact: true })
      .click();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toHaveCount(2);
    await expect(page.getByText("And how volatile is NVDA?")).toBeVisible();
  });

  test("web sources link out and a comparison table is shown", async ({ page }) => {
    await startUiSession(page);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("What does the web say about Mock Corp?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const answer = page.getByRole("region", { name: "Assistant answer" });
    await answer.getByText(/Sources and figures/).click();
    await expect(answer.getByRole("link", { name: /E2E Web Result/ })).toHaveAttribute(
      "href",
      "https://example.com/e2e-web-result",
    );

    await page
      .getByRole("button", { name: /New conversation/ })
      .first()
      .click();
    await page.getByLabel("Your question").fill("Compare these two please");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("region", { name: "Comparison (scrollable)" })).toBeVisible();
  });

  test("Stop ends the work and keeps the question", async ({ page }) => {
    await mock.setMode("slow");
    await startUiSession(page);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("Tell me about NVDA");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText(/Stopped. The question is kept/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
  });

  test("an unverifiable answer shows a notice instead of the invented number", async ({ page }) => {
    await mock.setMode("ungrounded");
    await startUiSession(page);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("Tell me about NVDA");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText(/could not be verified/)).toBeVisible();
    await expect(page.getByText("99.99")).toHaveCount(0);
  });

  test("a failed answer shows an error and the next question works", async ({ page }) => {
    await startUiSession(page);
    await page.goto("/research");
    await mock.setMode("error");
    await page.getByLabel("Your question").fill("Tell me about NVDA");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /failed/ })).toBeVisible();
    await mock.setMode("grounded");
    await page.getByLabel("Your question").fill("Tell me about NVDA again");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toBeVisible();
  });

  test("the company page starts a deep research brief", async ({ page }) => {
    await startUiSession(page);
    await page.goto("/research/NVDA");
    await page.getByRole("link", { name: "Deep research brief" }).click();
    await expect(
      page
        .getByRole("list", { name: "Conversation", exact: true })
        .getByText("Give me a research brief on NVDA"),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Deep research" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const req = (await mock.requests()).find((r) => r.path === "/v1/responses")!;
    expect(req.instructions).toMatch(/deep research request/);
  });
});

test.describe("visualizer and presentation", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("the deck API makes, stores and protects a presentation", async ({ page, playwright }) => {
    await startUiSession(page);
    await mock.setMode("ungrounded");
    const unverified = await askApi(page.request, { question: "Tell me about NVDA" });
    const t0 = unverified.events[0]!.threadId;
    const refused = await page.request.post(`/api/research/threads/${t0}/deck`);
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toMatch(/no verified answers/);

    await mock.setMode("grounded");
    const { events } = await askApi(page.request, { question: "Compare these two please" });
    const threadId = events[0]!.threadId;
    expect(
      ((await (await page.request.get(`/api/research/threads/${threadId}/deck`)).json()) as Json)
        .deck,
    ).toBeNull();
    const made = (await (
      await page.request.post(`/api/research/threads/${threadId}/deck`)
    ).json()) as Json;
    expect(made.deck.source).toBe("model");
    expect(made.deck.deck.slides).toHaveLength(3);
    expect(made.deck.deck.slides[1].display).toBe("D1");
    expect(made.deck.displays.map((d: Json) => d.kind)).toEqual([
      "table",
      "bar",
      "scatter",
      "heatmap",
    ]);
    const req = (await mock.requests()).find((r) => r.path === "/v1/responses#deck")!;
    expect(req.instructions).toMatch(/slide presentation/);
    expect(req.input).toContain("### Question 1: Compare these two please");

    const stored = (await (
      await page.request.get(`/api/research/threads/${threadId}/deck`)
    ).json()) as Json;
    expect(stored.deck.createdAt).toBe(made.deck.createdAt);
    const other = await newSession(playwright);
    expect((await other.get(`/api/research/threads/${threadId}/deck`)).status()).toBe(404);
    expect((await other.post(`/api/research/threads/${threadId}/deck`)).status()).toBe(404);

    await mock.setMode("ungrounded");
    const again = (await (
      await page.request.post(`/api/research/threads/${threadId}/deck`)
    ).json()) as Json;
    expect(again.deck.source).toBe("fallback");
    expect(JSON.stringify(again.deck.deck)).not.toContain("99.99");
    expect(again.deck.deck.slides[0].title).toBe("Compare these two please");
  });

  test("Visualize shows every chart of an answer with its key figures", async ({ page }) => {
    await startUiSession(page);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("Compare these two please");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.getByRole("button", { name: "Visualize" }).click();
    const charts = page.getByRole("region", { name: "Answer charts" });
    await expect(
      charts.getByRole("img", { name: "Bar chart: Returns by period (%)" }),
    ).toBeVisible();
    await expect(
      charts.getByRole("img", { name: /Scatter chart: Risk against return/ }),
    ).toBeVisible();
    await expect(charts.getByRole("region", { name: /Economic exposures/ })).toBeVisible();
    await page.getByRole("button", { name: "Hide charts" }).click();
    await expect(charts).toHaveCount(0);
  });

  test("the dashboard and the presentation work from a conversation", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed++;
      };
    });
    await startUiSession(page);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("Tell me about NVDA");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toBeVisible();

    await page
      .getByRole("group", { name: "Conversation views" })
      .getByRole("link", { name: "Dashboard" })
      .click();
    await expect(page.getByRole("heading", { name: "Tell me about NVDA", level: 1 })).toBeVisible();
    await expect(page.getByRole("img", { name: "Chart: NVDA price, last year" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Key figures" })).toContainText(
      "NVDA return over 1 year",
    );

    await page.getByRole("link", { name: "Presentation", exact: true }).click();
    await page.getByRole("button", { name: "Prepare presentation" }).click();
    const slide = page.getByRole("region", { name: /^Slide \d+ of 5$/ });
    await expect(slide).toContainText("Mock Deck");
    await page.keyboard.press("ArrowRight");
    await expect(slide.getByRole("heading", { name: "Summary" })).toBeVisible();
    await page.getByRole("button", { name: "Presenter view" }).click();
    await expect(page.getByRole("complementary", { name: "Speaker notes" })).toContainText(
      "Open with",
    );
    await expect(page.getByRole("complementary", { name: "Speaker notes" })).toContainText(
      "Next: The chart",
    );
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(slide.getByRole("img", { name: /NVDA price, last year/ })).toBeVisible();
    await page.getByRole("button", { name: /^5\. Sources/ }).click();
    await expect(slide.getByRole("heading", { name: "Sources" })).toBeVisible();

    await page.getByRole("button", { name: "Save as PDF" }).click();
    await expect(page.getByRole("region", { name: "Slides for printing" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed))
      .toBe(1);

    // Back to the conversation reopens it.
    await page.goto(page.url().replace(/\/research\/c\/([^/]+)\/deck$/, "/research?thread=$1"));
    await expect(page.getByText("Tell me about NVDA").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toBeVisible();
  });

  for (const theme of ["light", "dark"]) {
    test(`the dashboard and the presentation have no accessibility violations in ${theme}`, async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem("pl-theme", t), theme);
      await startUiSession(page);
      const { events } = await askApi(page.request, { question: "Compare these two please" });
      const threadId = events[0]!.threadId;
      await page.request.post(`/api/research/threads/${threadId}/deck`);
      const scan = async () => {
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
        const r = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
      };
      await page.goto(`/research/c/${threadId}/dashboard`);
      await expect(page.getByRole("region", { name: /Economic exposures/ })).toBeVisible();
      await scan();
      await page.goto(`/research/c/${threadId}/deck`);
      await page.getByRole("button", { name: "Next slide" }).click();
      await page.getByRole("button", { name: "Next slide" }).click();
      await page.getByRole("button", { name: "Presenter view" }).click();
      await scan();
    });
  }
});

test.describe("portfolio fit", () => {
  test.beforeEach(async () => {
    await mock.reset();
  });

  test("the fit API backtests a candidate and protects the portfolio", async ({
    page,
    playwright,
  }) => {
    const s = await startUiSession(page);
    const id = await s.create("Covered", COVERED);
    const r = (await (
      await page.request.get(`/api/portfolios/${id}/fit?ticker=MSFT&weight=0.1`)
    ).json()) as Json;
    expect(r.fit.weight).toBe(0.1);
    expect(r.fit.candidate.ticker).toBe("MSFT");
    expect(r.fit.correlation.byHolding.length).toBe(COVERED.length);
    expect(r.fit.stress.length).toBeGreaterThan(0);
    expect(r.displays[0]).toMatchObject({ id: "D1", kind: "table" });
    expect(
      (await page.request.get(`/api/portfolios/${id}/fit?ticker=MSFT&weight=0.9`)).status(),
    ).toBe(400);
    expect((await page.request.get(`/api/portfolios/${id}/fit?ticker=ZZZZ`)).status()).toBe(404);
    const other = await newSession(playwright);
    expect((await other.get(`/api/portfolios/${id}/fit?ticker=MSFT`)).status()).toBe(404);
  });

  test("asking how a company fits uses the portfolio and shows the fit charts", async ({
    page,
  }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("How would MSFT fit my portfolio?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const answer = page.getByRole("region", { name: "Assistant answer" });
    await expect(answer).toContainText("Fit of MSFT at 10%");
    await expect(
      answer.getByRole("region", { name: /Portfolio with and without MSFT/ }),
    ).toBeVisible();
  });

  test("an answer about a company offers a fit follow-up", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/research");
    await page.getByLabel("Your question").fill("Tell me about NVDA");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.getByRole("button", { name: "Fit to my portfolio" }).click();
    await expect(page.getByText("How would NVDA fit my portfolio?")).toBeVisible();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toHaveCount(2);
  });

  test("the company page shows the full fit", async ({ page }) => {
    const s = await startUiSession(page);
    await s.create("Covered", COVERED);
    await page.goto("/research/MSFT");
    const fit = page.getByRole("region", { name: "Portfolio fit" });
    await expect(
      fit.getByRole("region", { name: /Portfolio with and without MSFT at 5%/ }),
    ).toBeVisible();
    await fit.getByText("Correlations, scenarios and exposures").click();
    await expect(
      fit.getByRole("img", { name: /Correlation of MSFT with each holding/ }),
    ).toBeVisible();
    await expect(
      fit.getByRole("link", { name: "Ask the assistant about the fit" }),
    ).toHaveAttribute("href", /research\?ask=How%20would%20MSFT%20fit/);
  });
});
