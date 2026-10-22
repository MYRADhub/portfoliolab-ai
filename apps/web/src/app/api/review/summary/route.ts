import { route } from "@/server/errors";
import { db } from "@/server/db";
import { assertReviewer, reviewSummary } from "@/server/review";

export const GET = route(async (req) => {
  assertReviewer(req);
  return Response.json(await reviewSummary(db()));
});
