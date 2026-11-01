import { requireSessionId } from "@/server/current-session";
import { db } from "@/server/db";
import { route } from "@/server/errors";
import { listThreads } from "@/server/research-chat";

export const GET = route(async () => {
  const sid = await requireSessionId();
  return Response.json({ threads: await listThreads(db(), sid) });
});
