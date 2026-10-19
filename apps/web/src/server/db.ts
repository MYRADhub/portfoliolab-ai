import { createDb } from "@portfolio-lab/db";
import { env } from "./env";

const globalForDb = globalThis as unknown as { __db?: ReturnType<typeof createDb> };

export function db() {
  globalForDb.__db ??= createDb(env().DATABASE_URL);
  return globalForDb.__db.db;
}
