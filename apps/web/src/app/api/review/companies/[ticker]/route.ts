import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { assertReviewer, getReviewProfile, saveReviewedProfile, saveSchema } from "@/server/review";

const paramsSchema = z.object({ ticker: z.string().regex(/^[A-Za-z.\-]{1,10}$/) });

export const GET = route<{ ticker: string }>(async (req, _rid, ctx) => {
  assertReviewer(req);
  const { ticker } = paramsSchema.parse(await ctx.params);
  return Response.json(await getReviewProfile(db(), ticker));
});

export const PUT = route<{ ticker: string }>(async (req, _rid, ctx) => {
  assertReviewer(req);
  const { ticker } = paramsSchema.parse(await ctx.params);
  const body = saveSchema.parse(await req.json());
  return Response.json(await saveReviewedProfile(db(), ticker, body));
});
