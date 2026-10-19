import { route, AppError } from "@/server/errors";
import { db } from "@/server/db";
import { requireSessionId } from "@/server/current-session";
import { createPortfolio, createPortfolioSchema, listPortfolios } from "@/server/portfolios";

export const GET = route(async () => {
  const sid = await requireSessionId();
  return Response.json({ portfolios: await listPortfolios(db(), sid) });
});

export const POST = route(async (req) => {
  const sid = await requireSessionId();
  const body: unknown = await req.json().catch(() => {
    throw new AppError("bad_request", "Body must be valid JSON");
  });
  const portfolio = await createPortfolio(db(), sid, createPortfolioSchema.parse(body));
  return Response.json({ portfolio: { id: portfolio.id, name: portfolio.name } }, { status: 201 });
});
