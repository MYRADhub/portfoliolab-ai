import { describe, expect, it } from "vitest";
import { runAssistant, type AssistantModel, type AssistantTool, type AssistantTurn } from "./index";

const tool: AssistantTool = {
  name: "get_summary",
  description: "Portfolio summary",
  parameters: { type: "object", properties: {} },
  run: async () => [
    { label: "Annualized volatility", text: "18.4%" },
    { label: "Largest holding", text: "NVDA 40.0%" },
  ],
};

/** A model scripted as a list of turns per begin() call. Records what it was asked. */
function scripted(sessions: AssistantTurn[][]): AssistantModel & {
  begun: { question: string; feedback?: string }[];
  outputs: ({ callId: string; output: string }[] | null)[];
} {
  const begun: { question: string; feedback?: string }[] = [];
  const outputs: ({ callId: string; output: string }[] | null)[] = [];
  let i = 0;
  return {
    model: "fake",
    begun,
    outputs,
    begin(question, _tools, feedback) {
      begun.push({ question, feedback });
      const turns = sessions[i++] ?? [];
      let t = 0;
      return {
        async next(o) {
          outputs.push(o);
          return turns[t++] ?? { calls: [], text: null };
        },
      };
    },
  };
}

const call = (name = "get_summary", id = "c1"): AssistantTurn => ({
  calls: [{ id, name, arguments: "{}" }],
  text: null,
});
const say = (answer: string): AssistantTurn => ({ calls: [], text: JSON.stringify({ answer }) });

describe("runAssistant", () => {
  it("returns a grounded answer after a tool round and numbers facts from tool results", async () => {
    const m = scripted([[call(), say("Volatility is 18.4% [F1], led by NVDA 40.0% [F2].")]]);
    const r = await runAssistant(m, "how risky?", [tool]);
    expect(r.source).toBe("model");
    expect(r.facts.map((f) => f.id)).toEqual(["F1", "F2"]);
    expect(r.toolCalls).toEqual([{ name: "get_summary", arguments: "{}" }]);
    expect(m.outputs[1]![0]!.output).toBe(
      "F1 | Annualized volatility: 18.4%\nF2 | Largest holding: NVDA 40.0%",
    );
  });

  it("retries once with the problems and the gathered facts when a number is not in any fact", async () => {
    const m = scripted([
      [call(), say("Volatility is 25% [F1].")],
      [say("Volatility is 18.4% [F1].")],
    ]);
    const r = await runAssistant(m, "q", [tool]);
    expect(r.source).toBe("model");
    expect(m.begun[1]!.feedback).toContain("ungrounded_number (25)");
    expect(m.begun[1]!.feedback).toContain("F1 | Annualized volatility: 18.4%");
  });

  it("falls back to the facts when both attempts are ungrounded, and never returns the bad text", async () => {
    const m = scripted([[call(), say("Up 99%.")], [say("Up 98%.")]]);
    const r = await runAssistant(m, "q", [tool]);
    expect(r.source).toBe("fallback");
    expect(r.answer).not.toContain("99");
    expect(r.facts).toHaveLength(2);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it("rejects an answer given without calling any tool", async () => {
    const m = scripted([[say("It is fine.")], [say("Still fine.")]]);
    const r = await runAssistant(m, "q", [tool]);
    expect(r.source).toBe("fallback");
    expect(r.issues[0]!.detail).toMatch(/without using any tool/);
  });

  it("rejects advice wording and unknown citations", async () => {
    const m = scripted([
      [call(), say("You should sell NVDA 40.0% [F1].")],
      [say("Volatility is 18.4% [F9].")],
    ]);
    const r = await runAssistant(m, "q", [tool]);
    expect(r.source).toBe("fallback");
    expect(r.issues.map((i) => i.kind)).toContain("unknown_citation");
  });

  it("reports tool errors and unknown tools to the model instead of throwing", async () => {
    const bad: AssistantTool = {
      ...tool,
      name: "bad",
      run: async () => {
        throw new Error("boom");
      },
    };
    const m = scripted([
      [
        {
          calls: [
            { id: "a", name: "bad", arguments: "{}" },
            { id: "b", name: "nope", arguments: "{}" },
          ],
          text: null,
        },
        call("get_summary", "c"),
        say("Volatility is 18.4% [F1]."),
      ],
    ]);
    const r = await runAssistant(m, "q", [bad, tool]);
    expect(m.outputs[1]!.map((o) => o.output)).toEqual(["error: boom", "error: unknown tool nope"]);
    expect(r.source).toBe("model");
  });

  it("stops after the round limit and falls back when the model keeps calling tools", async () => {
    const loop = Array.from({ length: 10 }, () => call());
    const m = scripted([loop, loop]);
    const r = await runAssistant(m, "q", [tool], { maxRounds: 2 });
    expect(r.source).toBe("fallback");
    expect(m.outputs.length).toBeLessThanOrEqual(8);
  });

  it("reuses a fact id when a tool returns the same entry twice", async () => {
    const m = scripted([[call(), call("get_summary", "c2"), say("Volatility is 18.4% [F1].")]]);
    const r = await runAssistant(m, "q", [tool]);
    expect(r.facts).toHaveLength(2);
    expect(r.source).toBe("model");
  });

  it("treats malformed or empty model output as no answer", async () => {
    const m = scripted([
      [call(), { calls: [], text: "not json" }],
      [{ calls: [], text: JSON.stringify({ answer: "  " }) }],
    ]);
    expect((await runAssistant(m, "q", [tool])).source).toBe("fallback");
  });
});
