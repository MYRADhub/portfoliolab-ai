import { route } from "@/server/errors";
import { db } from "@/server/db";
import { analysis, assertAdmin } from "@/server/experiment";

export const GET = route(async (req) => {
  assertAdmin(req);
  return Response.json(await analysis(db()));
});
