import { route } from "@/server/errors";
import { db } from "@/server/db";
import { previewImport, previewSchema } from "@/server/import";

export const POST = route(async (req) => {
  const body = previewSchema.parse(await req.json());
  return Response.json(await previewImport(db(), body));
});
