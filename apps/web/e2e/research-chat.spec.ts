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
    expect(msg.answer.displays).toHaveLength(1);
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
    await expect(page.getByText("Give me a research brief on NVDA")).toBeVisible();
    await expect(page.getByRole("region", { name: "Assistant answer" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Deep research" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const req = (await mock.requests()).find((r) => r.path === "/v1/responses")!;
    expect(req.instructions).toMatch(/deep research request/);
  });
});
