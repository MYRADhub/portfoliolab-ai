import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { getCompanyResearch } from "@/server/research";

const paramsSchema = z.object({ ticker: z.string().regex(/^[A-Za-z.\-]{1,10}$/) });

export const GET = route<{ ticker: string }>(async (_req, _rid, ctx) => {
  const { ticker } = paramsSchema.parse(await ctx.params);
  return Response.json(await getCompanyResearch(db(), ticker));
});
