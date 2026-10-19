import { and, eq } from "drizzle-orm";
import { eventTypes, llmRuns, newsArticles, newsClassifications, type Db } from "@portfolio-lab/db";
import type { Classifier, ClassifierResult, Usage } from "./classifier";
import { EVENT_TYPES } from "./events";
import { inputHash } from "./prompt";
import { validatedOutputSchema } from "./schema";

const PURPOSE = "news_classification";

export async function seedEventTypes(db: Db): Promise<void> {
  await db
    .insert(eventTypes)
    .values(
      EVENT_TYPES.map((e) => ({
        slug: e.slug,
        name: e.name,
        defaultClass: e.defaultClass,
        definition: e.definition,
      })),
    )
    .onConflictDoNothing({ target: eventTypes.slug });
}

export interface StoreResult {
  status: ClassifierResult["status"];
  /** True when the answer came from the llm_runs cache and no API call was made. */
  cached: boolean;
  classificationId: number | null;
}

/**
 * Classifies one stored article. Results are cached by (purpose, model, prompt version, input hash), so
 * re-running is free and idempotent; a prompt or model change produces a new classification row.
 */
export async function classifyAndStore(
  db: Db,
  classifier: Classifier,
  articleId: number,
): Promise<StoreResult> {
  const [article] = await db.select().from(newsArticles).where(eq(newsArticles.id, articleId));
  if (!article) throw new Error(`unknown article ${articleId}`);

  const input = {
    title: article.title,
    snippet: article.snippet,
    body: article.body,
    sourceName: article.sourceName,
    publishedAt: article.publishedAt,
  };
  const hash = inputHash(classifier.model, input);
  const key = and(
    eq(llmRuns.purpose, PURPOSE),
    eq(llmRuns.model, classifier.model),
    eq(llmRuns.promptVersion, classifier.promptVersion),
    eq(llmRuns.inputHash, hash),
  );

  let [run] = await db.select().from(llmRuns).where(key);
  let cached = true;
  if (!run) {
    cached = false;
    const result = await classifier.classify(input);
    const usage: Usage = result.usage;
    await db
      .insert(llmRuns)
      .values({
        purpose: PURPOSE,
        model: classifier.model,
        promptVersion: classifier.promptVersion,
        inputHash: hash,
        status: result.status,
        outputJson: result.status === "ok" ? result.output : { detail: result.detail },
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cacheReadTokens: usage.cacheReadTokens,
      })
      .onConflictDoNothing();
    [run] = await db.select().from(llmRuns).where(key);
  }
  if (!run) throw new Error("llm run was not recorded");

  const status = run.status as ClassifierResult["status"];
  if (status !== "ok") return { status, cached, classificationId: null };

  const output = validatedOutputSchema.parse(run.outputJson);
  const [type] = await db
    .select({ id: eventTypes.id })
    .from(eventTypes)
    .where(eq(eventTypes.slug, output.event_type));
  if (!type)
    throw new Error(`event type ${output.event_type} is not seeded; run seedEventTypes first`);

  await db
    .insert(newsClassifications)
    .values({
      articleId,
      eventTypeId: type.id,
      class: output.classification,
      fundamentalImportance: output.fundamental_importance,
      marketRelevance: output.market_relevance,
      expectedPersistence: output.expected_persistence,
      mechanism: output.mechanism,
      confidence: output.confidence,
      model: classifier.model,
      promptVersion: classifier.promptVersion,
      llmRunId: run.id,
      contentHash: hash,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: newsClassifications.id })
    .from(newsClassifications)
    .where(
      and(
        eq(newsClassifications.articleId, articleId),
        eq(newsClassifications.model, classifier.model),
        eq(newsClassifications.promptVersion, classifier.promptVersion),
        eq(newsClassifications.contentHash, hash),
      ),
    );
  return { status, cached, classificationId: row?.id ?? null };
}
