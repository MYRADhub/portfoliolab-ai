import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { assertReviewer, getReviewProfile, saveReviewedProfile, saveSchema } from "@/server/review";

const paramsSchema = z.object({ ticker: z.string().regex(/^[A-Za-z.\-]{1,10}$/) });
const querySchema = z.object({ blind: z.enum(["0", "1"]).optional() });

export const GET = route<{ ticker: string }>(async (req, _rid, ctx) => {
  assertReviewer(req);
  const { ticker } = paramsSchema.parse(await ctx.params);
  const { blind } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await getReviewProfile(db(), ticker, { blind: blind === "1" }));
});

export const PUT = route<{ ticker: string }>(async (req, _rid, ctx) => {
  assertReviewer(req);
  const { ticker } = paramsSchema.parse(await ctx.params);
  const body = saveSchema.parse(await req.json());
  return Response.json(await saveReviewedProfile(db(), ticker, body));
});
