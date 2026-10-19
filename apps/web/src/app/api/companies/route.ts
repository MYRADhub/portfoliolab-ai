import { route } from "@/server/errors";
import { db } from "@/server/db";
import { searchCompanies } from "@/server/portfolios";

export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ companies: await searchCompanies(db(), q.slice(0, 40)) });
});
