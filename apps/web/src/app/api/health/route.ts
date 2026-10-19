import { sql } from "drizzle-orm";
import { route } from "@/server/errors";
import { db } from "@/server/db";

export const GET = route(async (req) => {
  // Reading the request keeps this handler dynamic under Cache Components.
  void req.headers;
  await db().execute(sql`select 1`);
  return Response.json({ status: "ok" });
});
