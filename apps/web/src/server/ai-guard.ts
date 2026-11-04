import type { Db } from "@portfolio-lab/db";
import { db } from "./db";
import { env } from "./env";
import { AppError } from "./errors";
import { EXPLAIN_LIMIT } from "./explain";
import { CLASSIFY_ONE_LIMIT, SCAN_LIMIT } from "./news-scan";
import { tryAcquireAll, type Limiter } from "./rate-limit";
import { RESEARCH_LIMITS } from "./research-chat";
import { DECK_LIMIT } from "./research-deck";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type AiFeature =
  "research_quick" | "research_deep" | "deck" | "explain" | "news_scan" | "news_classify";

interface Allowance {
  /** What the visitor is told ran out, as a plural noun phrase. */
  label: string;
  /** Per anonymous session, the allowance each feature already had. */
  session: { max: number; windowMs: number };
  /** Per network address, per hour. A little above the session allowance so a shared address is not punished. */
  perIpHour: number;
  /** For the whole site, over the last 24 hours. */
  perDay: number;
}

/**
 * Who may use how much AI. Sessions are free to create (clear the cookies and you have a new one), so on a public
 * site each AI call also counts against the caller's network address and a site-wide daily budget per feature.
 * AI_LIMIT_SCALE multiplies the last two.
 */
export const AI_ALLOWANCES: Record<AiFeature, Allowance> = {
  research_quick: {
    label: "research questions",
    session: RESEARCH_LIMITS.quick,
    perIpHour: 40,
    perDay: 400,
  },
  research_deep: {
    label: "deep research questions",
    session: RESEARCH_LIMITS.deep,
    perIpHour: 8,
    perDay: 60,
  },
  deck: { label: "presentations", session: DECK_LIMIT, perIpHour: 12, perDay: 60 },
  explain: { label: "explanations", session: EXPLAIN_LIMIT, perIpHour: 30, perDay: 600 },
  news_scan: { label: "news scans", session: SCAN_LIMIT, perIpHour: 8, perDay: 40 },
  news_classify: {
    label: "story classifications",
    session: CLASSIFY_ONE_LIMIT,
    perIpHour: 80,
    perDay: 400,
  },
};

/** The caller's address as the hosting edge reports it; one shared bucket when it does not. */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/**
 * The limiter handed to a server function for one AI feature. It admits an attempt only when the session, the
 * caller's address and the site all have room, and records it against all three at once. A full session allowance
 * returns false, so the function keeps its own message; a full address or site allowance throws with its own.
 */
export class AiLimiter implements Limiter {
  constructor(
    private readonly db: Db,
    private readonly feature: AiFeature,
    private readonly ip: string,
    private readonly opts: { scale?: number; enabled?: boolean; now?: () => Date } = {},
  ) {}

  async tryAcquire(sessionKey: string): Promise<boolean> {
    const a = AI_ALLOWANCES[this.feature];
    if (this.opts.enabled === false)
      throw new AppError("unavailable", `AI ${a.label} are switched off on this site for now.`);
    const scale = this.opts.scale ?? 1;
    const full = await tryAcquireAll(
      this.db,
      [
        { key: sessionKey, ...a.session },
        {
          key: `ai-ip:${this.feature}:${this.ip}`,
          max: Math.max(1, Math.round(a.perIpHour * scale)),
          windowMs: HOUR,
        },
        {
          key: `ai-day:${this.feature}`,
          max: Math.max(1, Math.round(a.perDay * scale)),
          windowMs: DAY,
        },
      ],
      this.opts.now?.() ?? new Date(),
    );
    if (full === null) return true;
    if (full === 0) return false;
    if (full === 1)
      throw new AppError(
        "rate_limited",
        `Too many ${a.label} from your network in the last hour. Try again later.`,
      );
    throw new AppError(
      "rate_limited",
      `This site's daily allowance of ${a.label} is used up. It frees up over the next 24 hours.`,
    );
  }
}

/** The AI limiter for a request, configured from the environment. */
export function aiLimiterFor(req: Request, feature: AiFeature): AiLimiter {
  const e = env();
  return new AiLimiter(db(), feature, clientIp(req), {
    scale: e.AI_LIMIT_SCALE,
    enabled: e.AI_ENABLED !== "0",
  });
}
