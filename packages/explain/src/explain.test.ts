import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import {
  OpenAIExplainer,
  allowedNumbers,
  buildInput,
  buildInstructions,
  checkGrounding,
  citedIds,
  explainPortfolio,
  factsFromEntries,
  type ExplainGenerator,
  type GroundingIssue,
  type RawExplanation,
} from "./index";

const facts = factsFromEntries([
  { label: "Window", text: "2025-10-20 to 2026-10-19 (261 trading days)" },
  { label: "Total return", text: "+30.7%" },
  { label: "Max drawdown", text: "-3.8%" },
  { label: "Largest holding", text: "NVDA 25%" },
  { label: "Position count", text: "1,234 positions" },
]);

const kinds = (text: string) => checkGrounding(text, facts).map((i) => `${i.kind}:${i.detail}`);

describe("checkGrounding", () => {
  it("accepts numbers that appear in the facts, ignoring sign and thousands separators", () => {
    expect(kinds("The portfolio returned 30.7% [F2] with a 3.8% drawdown [F3].")).toEqual([]);
    expect(kinds("It has 1234 positions [F5].")).toEqual([]);
    expect(kinds("Over 261 trading days in 2025 and 2026 [F1].")).toEqual([]);
  });

  it("flags numbers that are not facts, including rounded ones", () => {
    expect(kinds("It returned about 31% [F2].")).toEqual(["ungrounded_number:31"]);
    expect(kinds("It fell 4.2% at worst, and 12 stocks.")).toEqual([
      "ungrounded_number:4.2",
      "ungrounded_number:12",
    ]);
  });

  it("does not count citation ids as numbers and flags unknown citations", () => {
    expect(kinds("Growth was strong [F2].")).toEqual([]);
    expect(kinds("Growth was strong [F9].")).toEqual(["unknown_citation:F9"]);
    expect(citedIds("a [F1, F3] b [F12]")).toEqual(["F1", "F3", "F12"]);
  });

  it("rejects directive advice but not ordinary uses of the words", () => {
    expect(kinds("You should sell NVDA [F4].")).toContain(
      "advice:contains a buy/sell/hold directive",
    );
    expect(kinds("We recommend reducing your exposure.")).toContain(
      "advice:contains a buy/sell/hold directive",
    );
    expect(kinds("Consider adding more bonds.")).toContain(
      "advice:contains a buy/sell/hold directive",
    );
    expect(kinds("Tech stocks sold off last week and holders felt it.")).toEqual([]);
    expect(kinds("Consider how concentrated the portfolio is.")).toEqual([]);
  });

  it("rejects empty text", () => {
    expect(kinds("   ")).toEqual(["empty:empty text"]);
  });

  it("counts numbers in labels, such as a '1 year' window, as grounded", () => {
    const withLabel = factsFromEntries([{ label: "Average correlation (1 year)", text: "0.03" }]);
    expect(checkGrounding("Over 1 year the average was 0.03 [F1].", withLabel)).toEqual([]);
    expect(
      checkGrounding("Over 5 years it was 0.03 [F1].", withLabel).map((i) => i.detail),
    ).toEqual(["5"]);
  });

  it("collects allowed numbers from all facts", () => {
    expect([...allowedNumbers(facts)].sort()).toEqual(
      ["10", "1234", "19", "2025", "2026", "20", "25", "261", "3.8", "30.7"].sort(),
    );
  });
});

class FakeGenerator implements ExplainGenerator {
  readonly model = "fake";
  calls: GroundingIssue[][] = [];
  constructor(private readonly outputs: (RawExplanation | null)[]) {}
  tasks: (string | undefined)[] = [];
  async generate(_f: unknown, issues: readonly GroundingIssue[], task?: string) {
    this.tasks.push(task);
    this.calls.push([...issues]);
    return this.outputs[Math.min(this.calls.length - 1, this.outputs.length - 1)] ?? null;
  }
}

const good: RawExplanation = {
  summary: "The portfolio returned 30.7% over the window [F2, F1].",
  highlights: ["The worst drawdown was 3.8% [F3].", "NVDA is the largest holding at 25% [F4]."],
};
const bad: RawExplanation = { summary: "The portfolio returned about 31% [F2].", highlights: [] };

describe("explainPortfolio", () => {
  it("returns a grounded model explanation on the first attempt", async () => {
    const g = new FakeGenerator([good]);
    const r = await explainPortfolio(g, facts);
    expect(r).toMatchObject({ source: "model", model: "fake", issues: [] });
    expect(g.calls).toHaveLength(1);
  });

  it("retries once with the problems listed and accepts a corrected answer", async () => {
    const g = new FakeGenerator([bad, good]);
    const r = await explainPortfolio(g, facts);
    expect(r.source).toBe("model");
    expect(g.calls[1]).toEqual([{ kind: "ungrounded_number", detail: "31" }]);
  });

  it("falls back to deterministic text when the model stays ungrounded, never returning ungrounded prose", async () => {
    const g = new FakeGenerator([bad, bad]);
    const r = await explainPortfolio(g, facts);
    expect(r.source).toBe("fallback");
    expect(r.issues).toEqual([{ kind: "ungrounded_number", detail: "31" }]);
    expect(r.summary).not.toContain("31");
    expect(r.highlights[0]).toBe("Window: 2025-10-20 to 2026-10-19 (261 trading days) [F1]");
    expect(g.calls).toHaveLength(2);
  });

  it("passes a custom task to the generator on every attempt", async () => {
    const g = new FakeGenerator([bad, good]);
    await explainPortfolio(g, facts, { task: "Explain the move on 2026-01-05." });
    expect(g.tasks).toEqual(["Explain the move on 2026-01-05.", "Explain the move on 2026-01-05."]);
    const plain = new FakeGenerator([good]);
    await explainPortfolio(plain, facts);
    expect(plain.tasks).toEqual([undefined]);
  });

  it("validates highlights as well as the summary", async () => {
    const g = new FakeGenerator([{ summary: good.summary, highlights: ["It rose 99% [F2]."] }]);
    expect((await explainPortfolio(g, facts)).source).toBe("fallback");
  });

  it("treats missing output as a failed attempt and caps highlights at four", async () => {
    expect((await explainPortfolio(new FakeGenerator([null]), facts)).source).toBe("fallback");
    const many = { summary: good.summary, highlights: Array(6).fill("NVDA is 25% [F4].") };
    expect((await explainPortfolio(new FakeGenerator([many]), facts)).highlights).toHaveLength(4);
  });
});

describe("prompt and OpenAI client", () => {
  it("lists facts with ids and appends rejection feedback", () => {
    const plain = buildInput(facts);
    expect(plain).toContain("F2 | Total return: +30.7%");
    expect(plain).not.toContain("rejected");
    expect(plain.endsWith("Explain this portfolio.")).toBe(true);
    expect(buildInput(facts, [], "Explain the move.").endsWith("Explain the move.")).toBe(true);
    expect(buildInput(facts, [{ kind: "ungrounded_number", detail: "31" }])).toContain(
      "ungrounded_number (31)",
    );
    expect(buildInstructions()).toMatch(/Never tell the reader to buy/);
  });

  it("returns null for incomplete or unparseable responses and parses valid ones", async () => {
    const make = (r: object) =>
      new OpenAIExplainer({ responses: { parse: async () => r } } as unknown as OpenAI, "m");
    expect(
      await make({ status: "incomplete", output_parsed: null }).generate(facts, []),
    ).toBeNull();
    expect(
      await make({ status: "completed", output_parsed: { nope: 1 } }).generate(facts, []),
    ).toBeNull();
    expect(await make({ status: "completed", output_parsed: good }).generate(facts, [])).toEqual(
      good,
    );
  });
});
