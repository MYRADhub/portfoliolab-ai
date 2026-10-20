import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Fact } from "./facts";
import { checkGrounding, type GroundingIssue } from "./grounding";
import { buildInput, buildInstructions, EXPLAIN_PROMPT_VERSION } from "./prompt";

export const explanationSchema = z.object({
  summary: z.string(),
  highlights: z.array(z.string()),
});
export type RawExplanation = z.infer<typeof explanationSchema>;

export interface ExplainGenerator {
  readonly model: string;
  generate(
    facts: readonly Fact[],
    issues: readonly GroundingIssue[],
  ): Promise<RawExplanation | null>;
}

export const DEFAULT_EXPLAIN_MODEL = "gpt-6-sol";

export class OpenAIExplainer implements ExplainGenerator {
  constructor(
    private readonly client: OpenAI,
    readonly model: string = DEFAULT_EXPLAIN_MODEL,
  ) {}

  async generate(
    facts: readonly Fact[],
    issues: readonly GroundingIssue[],
  ): Promise<RawExplanation | null> {
    const response = await this.client.responses.parse({
      model: this.model,
      instructions: buildInstructions(),
      input: buildInput(facts, issues),
      text: { format: zodTextFormat(explanationSchema, "portfolio_explanation") },
    });
    if (response.status === "incomplete") return null;
    const parsed = explanationSchema.safeParse(response.output_parsed);
    return parsed.success ? parsed.data : null;
  }
}

export interface Explanation {
  source: "model" | "fallback";
  summary: string;
  highlights: string[];
  model: string | null;
  promptVersion: string;
  /** Grounding problems from the last rejected attempt, when the fallback was used. */
  issues: GroundingIssue[];
}

/** Deterministic text built only from facts. Used when the model fails or cannot be grounded. */
export function fallbackExplanation(
  facts: readonly Fact[],
): Pick<Explanation, "summary" | "highlights"> {
  return {
    summary:
      "An automatic written explanation is not available right now. The computed figures are listed below.",
    highlights: facts.slice(0, 8).map((f) => `${f.label}: ${f.text} [${f.id}]`),
  };
}

const MAX_ATTEMPTS = 2;

/**
 * Generates an explanation and verifies it against the facts. A rejected attempt is retried once with the
 * problems listed; if it still fails, the deterministic fallback is returned. Ungrounded prose never reaches the user.
 */
export async function explainPortfolio(
  generator: ExplainGenerator,
  facts: readonly Fact[],
): Promise<Explanation> {
  let issues: GroundingIssue[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = await generator.generate(facts, issues);
    if (!raw) {
      issues = [{ kind: "empty", detail: "no usable output" }];
      continue;
    }
    const found = [
      ...checkGrounding(raw.summary, facts),
      ...raw.highlights.flatMap((h) => checkGrounding(h, facts)),
    ];
    if (found.length === 0) {
      return {
        source: "model",
        summary: raw.summary.trim(),
        highlights: raw.highlights
          .map((h) => h.trim())
          .filter(Boolean)
          .slice(0, 4),
        model: generator.model,
        promptVersion: EXPLAIN_PROMPT_VERSION,
        issues: [],
      };
    }
    issues = found;
  }
  return {
    source: "fallback",
    ...fallbackExplanation(facts),
    model: generator.model,
    promptVersion: EXPLAIN_PROMPT_VERSION,
    issues,
  };
}

/** Builds the OpenAI-backed explainer so callers never need their own copy of the SDK. */
export function createOpenAIExplainer(
  apiKey: string,
  model: string = DEFAULT_EXPLAIN_MODEL,
): OpenAIExplainer {
  return new OpenAIExplainer(new OpenAI({ apiKey }), model);
}
