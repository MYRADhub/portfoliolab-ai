import { z } from "zod";
import { route } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { CORRELATION_WINDOWS, getPortfolioCorrelation } from "@/server/correlation";

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  window: z
    .enum(
      Object.keys(CORRELATION_WINDOWS) as [
        keyof typeof CORRELATION_WINDOWS,
        ...(keyof typeof CORRELATION_WINDOWS)[],
      ],
    )
    .default("1y"),
});

export const GET = route<{ id: string }>(async (req, _rid, ctx) => {
  const sid = await requireSessionId();
  const { id } = paramsSchema.parse(await ctx.params);
  const { window } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await getPortfolioCorrelation(db(), sid, id, { window }));
});
