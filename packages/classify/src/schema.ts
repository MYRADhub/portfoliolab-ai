import { z } from "zod";
import { EVENT_SLUGS } from "./events";

export const CLASSES = ["fundamental", "narrative", "noise", "unclear"] as const;
export type Classification = (typeof CLASSES)[number];

/** Shape sent to the API as the structured-output schema. */
export const outputSchema = z.object({
  event_type: z.enum(EVENT_SLUGS),
  classification: z.enum(CLASSES),
  fundamental_importance: z.number().int(),
  market_relevance: z.number().int(),
  expected_persistence: z.number().int(),
  mechanism: z.string(),
  confidence: z.number(),
});

export type ClassifierOutput = z.infer<typeof outputSchema>;

const score = z.number().int().min(0).max(10);

/** Stricter check applied to every response; range limits are not expressible in the API schema. */
export const validatedOutputSchema = outputSchema.extend({
  fundamental_importance: score,
  market_relevance: score,
  expected_persistence: score,
  mechanism: z.string().trim().min(1).max(600),
  confidence: z.number().min(0).max(1),
});

export interface ArticleInput {
  title: string;
  snippet?: string | null;
  body?: string | null;
  sourceName?: string | null;
  publishedAt: Date | string;
}
