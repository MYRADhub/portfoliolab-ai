import { z } from "zod";

const optionalKey = z.string().min(1).optional();

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  ANALYTICS_URL: z.string().url(),
  OPENAI_API_KEY: optionalKey,
  TIINGO_API_KEY: optionalKey,
  FINNHUB_API_KEY: optionalKey,
  MARKETAUX_API_KEY: optionalKey,
  ALPHAVANTAGE_API_KEY: optionalKey,
  FRED_API_KEY: optionalKey,
  /** "1" turns the research study on. Off by default: no data is collected from participants unless set. */
  EXPERIMENT_ENABLED: z.enum(["0", "1"]).optional(),
  /**
   * Comma-separated tickers the study universe is limited to, or "gold" for the gold set. Defaults to every company
   * with exposure data.
   */
  EXPERIMENT_UNIVERSE: z.string().optional(),
  /** "1" marks new participants as pilot participants, who are reported apart from the main analysis. */
  EXPERIMENT_PILOT: z.enum(["0", "1"]).optional(),
  /**
   * Details from the approval, shown on the consent screen. The study does not enrol anyone until the first four are
   * set. STUDY_END is the date after which participants may discuss the study (YYYY-MM-DD).
   */
  STUDY_RESEARCHER: z.string().min(2).max(200).optional(),
  STUDY_APPROVAL: z.string().min(2).max(300).optional(),
  STUDY_CONTACT: z.string().min(2).max(200).optional(),
  STUDY_RETENTION: z.string().min(2).max(300).optional(),
  STUDY_END: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** "1" lets people under 18 take part once they confirm a parent or guardian has signed the consent form. */
  STUDY_ALLOW_MINORS: z.enum(["0", "1"]).optional(),
  /**
   * "1" gives every new visitor the sample portfolios, an example everyday portfolio and a starter watchlist, so a
   * fresh browser opens on a full app. For local exploration and demos; leave unset where visitors bring their own.
   */
  EXAMPLE_DATA: z.enum(["0", "1"]).optional(),
  /** Secret for the exposure review tool at /review. With none set the tool does not exist. */
  REVIEW_TOKEN: z.string().min(16).optional(),
  EXPERIMENT_ADMIN_TOKEN: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}
