import { z } from "zod";
import { route, AppError } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { loadSamples, SAMPLES } from "@/server/samples";

const bodySchema = z.object({ keys: z.array(z.string().min(1).max(40)).max(20).optional() });

/** The catalogue of sample portfolios. Public: it contains no user data. */
export const GET = route(async (req) => {
  void req.headers;
  return Response.json({ samples: SAMPLES });
});

export const POST = route(async (req) => {
  const sid = await requireSessionId();
  const text = await req.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new AppError("bad_request", "Body must be valid JSON");
    }
  }
  const { keys } = bodySchema.parse(body);
  const result = await loadSamples(db(), sid, keys);
  return Response.json(result, { status: result.created.length ? 201 : 200 });
});
