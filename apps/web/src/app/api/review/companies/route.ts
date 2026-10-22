import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { assertReviewer, listForReview } from "@/server/review";

const querySchema = z.object({
  status: z.enum(["draft", "illustrative", "reviewed", "none", "all"]).optional(),
  q: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(600).optional(),
});

export const GET = route(async (req) => {
  assertReviewer(req);
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json({ companies: await listForReview(db(), q) });
});
