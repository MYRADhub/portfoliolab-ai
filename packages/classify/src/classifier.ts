import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const DEFAULT_MODEL = "claude-opus-5-5";

export class AnthropicClassifier implements Classifier {
  readonly promptVersion = PROMPT_VERSION;

  constructor(
    private readonly client: Anthropic,
    readonly model: string = DEFAULT_MODEL,
    private readonly effort: Effort = "low",
  ) {}

  async classify(article: ArticleInput): Promise<ClassifierResult> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: [{ type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserMessage(article) }],
      output_config: { effort: this.effort, format: zodOutputFormat(outputSchema) },
    });

    const usage: Usage = {
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? null,
    };

    if (response.stop_reason === "refusal") {
      return { status: "refusal", detail: response.stop_details?.category ?? "refused", usage };
    }
    if (response.stop_reason === "max_tokens") {
      return { status: "truncated", detail: "response hit max_tokens", usage };
    }
    const checked = validatedOutputSchema.safeParse(response.parsed_output);
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
