import { describe, expect, it } from "vitest";
import {
  AssistantAborted,
  assistantInstructions,
  checkGrounding,
  cleanSnippet,
  pickPassages,
  resultsFromOutput,
  runAssistant,
  splitPassages,
  stripMarkdownStructure,
  type AssistantEvent,
  type AssistantModel,
  type AssistantTool,
  type AssistantTurn,
  type BeginOptions,
} from "./index";

function scripted(sessions: AssistantTurn[][]): AssistantModel & { opts: BeginOptions[] } {
  const opts: BeginOptions[] = [];
  let i = 0;
  return {
    model: "fake",
    opts,
    begin(_q, _t, _f, o) {
      opts.push(o ?? {});
      const turns = sessions[i++] ?? [];
      let t = 0;
      return { next: async () => turns[t++] ?? { calls: [], text: null } };
    },
  };
}

const say = (answer: string, displays: string[] = []): AssistantTurn => ({
  calls: [],
  text: JSON.stringify({ answer, displays }),
});
const calls = (...names: string[]): AssistantTurn => ({
  calls: names.map((name, i) => ({ id: `c${i}`, name, arguments: "{}" })),
  text: null,
});

const price: AssistantTool = {
  name: "price",
  description: "",
  parameters: {},
  run: async () => ({
    entries: [{ label: "NVDA return over 1 year", text: "+42.0%" }],
    display: {
      kind: "table",
      title: "Returns",
      columns: ["Ticker", "1y"],
      rows: [["NVDA", "+42.0%"]],
    },
  }),
};
const web: AssistantTool = {
  name: "web",
  description: "",
  parameters: {},
  run: async () => [
    {
      label: "NVIDIA results (nvidia.com)",
      text: "Revenue of $96.2 billion, up 106% from a year ago",
      kind: "web",
      source: { url: "https://nvidia.com/q2", title: "NVIDIA results" },
    },
  ],
};

describe("research mode", () => {
  it("runs parallel calls, numbers facts in call order, keeps sources, and shows only chosen displays", async () => {
    const m = scripted([
      [
        calls("price", "web"),
        say("NVDA rose +42.0% [F1]; revenue was $96.2 billion [F2].", ["D1", "D9", "D1"]),
      ],
    ]);
    const events: AssistantEvent[] = [];
    const r = await runAssistant(m, "q", [price, web], {
      mode: "quick",
      onEvent: (e) => events.push(e),
    });
    expect(r.source).toBe("model");
    expect(r.promptVersion).toBe("research-v1");
    expect(r.facts.map((f) => [f.id, f.kind ?? "data"])).toEqual([
      ["F1", "data"],
      ["F2", "web"],
    ]);
    expect(r.facts[1]!.source?.url).toBe("https://nvidia.com/q2");
    expect(r.displays.map((d) => d.id)).toEqual(["D1"]);
    expect(events.map((e) => e.type)).toEqual([
      "tool_start",
      "tool_start",
      "tool_done",
      "tool_done",
      "checking",
    ]);
    expect(m.opts[0]!.mode).toBe("quick");
  });

  it("shows no displays in a fallback", async () => {
    const m = scripted([[calls("price"), say("Up 77% [F1].", ["D1"])], [say("Up 78%.", ["D1"])]]);
    const r = await runAssistant(m, "q", [price], { mode: "deep" });
    expect(r.source).toBe("fallback");
    expect(r.displays).toEqual([]);
  });

  it("reports a retry event with the issues", async () => {
    const m = scripted([[calls("price"), say("Up 77% [F1].")], [say("Up +42.0% [F1].")]]);
    const events: AssistantEvent[] = [];
    const r = await runAssistant(m, "q", [price], {
      mode: "quick",
      onEvent: (e) => events.push(e),
    });
    expect(r.source).toBe("model");
    const retry = events.find((e) => e.type === "retry");
    expect(retry && "issues" in retry && retry.issues[0]!.detail).toBe("77");
  });

  it("stops with AssistantAborted when the signal fires", async () => {
    const ctl = new AbortController();
    const slow: AssistantTool = {
      ...price,
      run: async () => {
        ctl.abort();
        return [];
      },
    };
    const m = scripted([[calls("price"), say("x")]]);
    await expect(
      runAssistant(m, "q", [slow], { mode: "quick", signal: ctl.signal }),
    ).rejects.toBeInstanceOf(AssistantAborted);
  });

  it("uses different instructions per mode and keeps the portfolio prompt unchanged", () => {
    expect(assistantInstructions()).toContain("at most 150 words");
    expect(assistantInstructions("quick")).toContain("300 words");
    expect(assistantInstructions("deep")).toContain("## What is uncertain");
    expect(assistantInstructions("deep")).toContain("Do not write URLs");
  });
});

describe("grounding with markdown", () => {
  const facts = [{ id: "F1", label: "Revenue", text: "$96.2 billion" }];

  it("ignores list numbers, headings, table rules, link targets and form names", () => {
    const text = `## Summary\n1. Revenue was $96.2 billion [F1].\n2. See the [10-K](https://sec.gov/x/123456) and Q2 notes; S&P 500 context.\n\n| A | B |\n|---|---|\n| Rev | $96.2 billion |`;
    expect(checkGrounding(text, facts)).toEqual([]);
  });

  it("still checks numbers inside tables and link text", () => {
    expect(checkGrounding("| Rev | $97 billion |", facts).map((i) => i.detail)).toEqual(["97"]);
    expect(checkGrounding("[up 12%](https://x.com)", facts).map((i) => i.detail)).toEqual(["12"]);
  });

  it("strips structure only", () => {
    expect(stripMarkdownStructure("### Title\n3) item")).toBe("Title\nitem");
  });
});

describe("web results", () => {
  it("cleans tool markup and keeps the publication date", () => {
    const raw =
      "citeturn305141search0 [wordlim: 200] Published: 3 months ago; Crawled: today; CUPERTINO, CALIFORNIA Apple today announced financial results. The Company posted quarterly revenue of $109.4 billion.";
    const r = cleanSnippet(raw);
    expect(r.published).toBe("3 months ago");
    expect(r.text).toBe(
      "CUPERTINO, CALIFORNIA Apple today announced financial results. The Company posted quarterly revenue of $109.4 billion.",
    );
    expect(r.text).not.toMatch(/turn|wordlim|305141/);
  });

  it("drops line-number prefixes and opened-page metadata", () => {
    const raw =
      'citeturn391216view0 [wordlim: 200] Crawled: today; Content type: text/html; Source: open({"ref_id":"turn1search0"}); Total lines: 462\nL45: # NVIDIA Results\nL47:   * Revenue of $96.2 billion, up 106% from a year ago';
    const r = cleanSnippet(raw);
    expect(r.text).toBe("# NVIDIA Results * Revenue of $96.2 billion, up 106% from a year ago");
  });

  it("collects excerpts from search calls, de-duplicates by URL and falls back to the opened page URL", () => {
    const long = "Some long enough page text that says revenue grew strongly this quarter.";
    const out = resultsFromOutput([
      { type: "reasoning" },
      {
        type: "web_search_call",
        action: { type: "search" },
        results: [
          { type: "text_result", snippet: long, title: "A", url: "https://a.com/1" },
          { type: "text_result", snippet: long, title: "A again", url: "https://a.com/1" },
          { type: "text_result", snippet: "short", title: "B", url: "https://b.com" },
          { type: "text_result", snippet: long, title: "C", url: "javascript:alert(1)" },
        ],
      },
      {
        type: "web_search_call",
        action: { type: "open_page", url: "https://www.d.com/x" },
        results: [{ snippet: long }],
      },
    ]);
    expect(out.map((r) => [r.title, r.url])).toEqual([
      ["A", "https://a.com/1"],
      ["d.com", "https://www.d.com/x"],
    ]);
  });
});

describe("passages", () => {
  const text = Array.from({ length: 30 }, (_, i) =>
    i === 17
      ? "Supply of advanced packaging capacity remains constrained and tariffs may raise costs."
      : `Sentence number ${i} about ordinary matters of the business.`,
  ).join(" ");

  it("splits into passages near the target size", () => {
    const p = splitPassages(text, 40);
    expect(p.length).toBeGreaterThan(5);
    expect(p.every((x) => x.text.split(" ").length <= 50)).toBe(true);
    expect(p.map((x) => x.text).join(" ")).toBe(text);
  });

  it("picks the passages about the focus, in document order", () => {
    const p = pickPassages(text, "packaging supply tariffs", 2);
    expect(p[0]!.text).toContain("advanced packaging");
    expect(p.length).toBeLessThanOrEqual(2);
  });

  it("returns the opening passages without a focus and nothing for an unmatched one", () => {
    expect(pickPassages(text, undefined, 2).map((p) => p.index)).toEqual([1, 2]);
    expect(pickPassages(text, "zebra", 2)).toEqual([]);
  });
});
