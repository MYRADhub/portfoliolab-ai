import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb } from "./client";

/** Creates an isolated, migrated database for one test file and returns a teardown. */
export async function createTestDb() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required to run db tests");
  const name = `pl_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(base, { max: 1 });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(base);
  url.pathname = `/${name}`;
  const { db, close } = createDb(url.toString());
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
  return {
    db,
    async teardown() {
      await close();
      await admin.unsafe(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}
