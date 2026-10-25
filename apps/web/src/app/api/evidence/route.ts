import { route } from "@/server/errors";
import { db } from "@/server/db";
import { getEvidence } from "@/server/evidence";

let cache: { at: number; value: unknown } | null = null;
const CACHE_MS = 10 * 60_000;

/** Portfolio-independent, so it needs no session. Cached because it re-runs three studies. */
export const GET = route(async () => {
  if (cache && Date.now() - cache.at < CACHE_MS) return Response.json(cache.value);
  const value = await getEvidence(db());
  cache = { at: Date.now(), value };
  return Response.json(value);
});
