import { route } from "@/server/errors";
import { db } from "@/server/db";
import { getEventStudy } from "@/server/events";

export const GET = route(async () => Response.json(await getEventStudy(db())));
