import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { buildSystemPrompt, buildUserMessage, PROMPT_VERSION } from "./prompt";
import {
  outputSchema,
  validatedOutputSchema,
  type ArticleInput,
  type ClassifierOutput,
} from "./schema";

export interface Usage {
  tokensIn: number | null;
  tokensOut: number | null;
  cacheReadTokens: number | null;
}

export type ClassifierResult =
  | { status: "ok"; output: ClassifierOutput; usage: Usage }
  | { status: "refusal" | "truncated" | "invalid"; detail: string; usage: Usage };

export interface Classifier {
  readonly model: string;
  readonly promptVersion: string;
  classify(article: ArticleInput): Promise<ClassifierResult>;
}

/** Same mid-tier model the sibling logistics-ai project uses for structured extraction. */
export const DEFAULT_MODEL = "gpt-6-sol";

export class OpenAIClassifier implements Classifier {
  readonly promptVersion = PROMPT_VERSION;

  constructor(
    private readonly client: OpenAI,
    readonly model: string = DEFAULT_MODEL,
  ) {}

  async classify(article: ArticleInput): Promise<ClassifierResult> {
    const response = await this.client.responses.parse({
      model: this.model,
      instructions: buildSystemPrompt(),
      input: buildUserMessage(article),
      text: { format: zodTextFormat(outputSchema, "news_classification") },
    });

    const usage: Usage = {
      tokensIn: response.usage?.input_tokens ?? null,
      tokensOut: response.usage?.output_tokens ?? null,
      cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
    };

    const refusal = response.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content)
      .find((part) => part.type === "refusal");
    if (refusal) return { status: "refusal", detail: refusal.refusal, usage };

    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason ?? "unknown";
      return {
        status: reason === "content_filter" ? "refusal" : "truncated",
        detail: reason,
        usage,
      };
    }

    const checked = validatedOutputSchema.safeParse(response.output_parsed);
    if (!checked.success) {
      return {
        status: "invalid",
        detail: checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        usage,
      };
    }
    return { status: "ok", output: checked.data, usage };
  }
}
