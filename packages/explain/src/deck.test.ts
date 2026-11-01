import { describe, expect, it } from "vitest";
import {
  deckPrompt,
  fallbackDeck,
  generateDeck,
  type Deck,
  type DeckGenerator,
  type DeckInput,
} from "./index";

const input: DeckInput = {
  topic: "NVDA research",
  sections: [
    {
      question: "How has NVDA done?",
      answer: "Up +42.0% [F1].",
      factIds: ["F1", "F2"],
      displayIds: ["D1"],
    },
    {
      question: "What are the risks?",
      answer: "Export rules [F3].",
      factIds: ["F3"],
      displayIds: [],
    },
  ],
  facts: [
    { id: "F1", label: "NVDA return over 1 year", text: "+42.0%" },
    { id: "F2", label: "NVDA annualized volatility", text: "37.5%" },
    {
      id: "F3",
      label: "NVDA 10-Q, Risk Factors, passage 4",
      text: "Export controls could reduce demand.",
      kind: "filing",
      source: { url: "https://www.sec.gov/x" },
    },
  ],
  displays: [{ id: "D1", kind: "table", title: "Returns", columns: ["Ticker"], rows: [["NVDA"]] }],
};

const slide = (title: string, bullets: string[], display: string | null = null) => ({
  title,
  bullets,
  display,
  notes: `Explain ${title.toLowerCase()} [F1].`,
});
const good: Deck = {
  title: "NVDA",
  subtitle: "What the research found",
  slides: [
    slide("Summary", ["NVDA rose +42.0% over a year [F1]."]),
    slide("Returns and risk", ["Volatility was 37.5% [F2]."], "D1"),
    slide("What is uncertain", ["Export controls could reduce demand [F3]."]),
  ],
};

function gen(...outputs: unknown[]): DeckGenerator & { prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    model: "fake",
    prompts,
    async generate(p) {
      prompts.push(p);
      return outputs[i++] ?? null;
    },
  };
}

describe("generateDeck", () => {
  it("accepts a grounded deck", async () => {
    const r = await generateDeck(gen(good), input);
    expect(r.source).toBe("model");
    expect(r.deck).toEqual(good);
    expect(r.promptVersion).toBe("deck-v1");
  });

  it("retries with the problems when a number, a chart id or advice is wrong, then accepts a fix", async () => {
    const bad: Deck = {
      ...good,
      slides: [
        slide("Summary", ["NVDA rose 50% [F1]. You should buy NVDA."]),
        slide("Chart", ["See it [F2]."], "D9"),
        good.slides[2]!,
      ],
    };
    const g = gen(bad, good);
    const r = await generateDeck(g, input);
    expect(r.source).toBe("model");
    expect(g.prompts[1]).toContain("ungrounded_number (50)");
    expect(g.prompts[1]).toContain("unknown_citation (D9)");
    expect(g.prompts[1]).toContain("advice");
  });

  it("checks speaker notes too", async () => {
    const g = gen(
      {
        ...good,
        slides: [{ ...good.slides[0]!, notes: "It doubled to 99% [F1]." }, ...good.slides.slice(1)],
      },
      good,
    );
    const r = await generateDeck(g, input);
    expect(r.source).toBe("model");
    expect(g.prompts[1]).toContain("ungrounded_number (99)");
  });

  it("falls back to a plain deck of verified figures after two failures", async () => {
    const r = await generateDeck(gen({ nope: 1 }, { ...good, slides: [good.slides[0]!] }), input);
    expect(r.source).toBe("fallback");
    expect(r.issues[0]!.detail).toMatch(/3 to 12 slides/);
    expect(r.deck.slides.map((s) => s.title)).toEqual([
      "How has NVDA done?",
      "What are the risks?",
    ]);
    expect(r.deck.slides[0]!.bullets).toEqual([
      "NVDA return over 1 year: +42.0% [F1]",
      "NVDA annualized volatility: 37.5% [F2]",
    ]);
    expect(r.deck.slides[0]!.display).toBe("D1");
  });

  it("rejects a deck that cites nothing and needs at least one answer", async () => {
    const plain = {
      ...good,
      slides: good.slides.map((s) => ({ ...s, bullets: ["Words only."], notes: "Words." })),
    };
    expect((await generateDeck(gen(plain, plain), input)).issues.map((i) => i.detail)).toContain(
      "no slide cites a fact",
    );
    await expect(generateDeck(gen(good), { ...input, sections: [] })).rejects.toThrow(
      /at least one/,
    );
  });
});

describe("deck prompt and fallback", () => {
  it("lists facts, displays and answers", () => {
    const p = deckPrompt(input);
    expect(p).toContain(
      "F3 | NVDA 10-Q, Risk Factors, passage 4: Export controls could reduce demand.",
    );
    expect(p).toContain('D1 | table "Returns" (1 rows)');
    expect(p).toContain("### Question 2: What are the risks?");
  });

  it("titles the fallback from the topic and counts answers", () => {
    expect(fallbackDeck({ ...input, sections: [input.sections[1]!] }).subtitle).toBe(
      "Figures from 1 verified answer",
    );
  });
});
