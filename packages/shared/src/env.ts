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
  /** Comma-separated tickers the study universe is limited to. Defaults to every company with exposure data. */
  EXPERIMENT_UNIVERSE: z.string().optional(),
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
