// Usage: tsx src/cli.ts [--db pl_demo]
// Creates (or refreshes) a demo database next to the dev database, with migrations, the S&P 500 universe and demo data.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb } from "@portfolio-lab/db";
import { loadConstituents, type Constituent } from "@portfolio-lab/data";
import { seedDemoData } from "./seed";

const { values } = parseArgs({ options: { db: { type: "string", default: "pl_demo" } } });
const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL is required");
const name = values.db!;
if (!/^[a-z0-9_]+$/.test(name))
  throw new Error("database name may only use lowercase letters, digits and underscores");

async function main() {
  const admin = postgres(base!, { max: 1, onnotice: () => undefined });
  const exists = await admin`select 1 from pg_database where datname = ${name}`;
  if (exists.length === 0) await admin.unsafe(`create database ${name}`);
  await admin.end();

  const url = new URL(base!);
  url.pathname = `/${name}`;
  const { db, close } = createDb(url.toString());
  const root = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");
  await migrate(db, { migrationsFolder: `${root}/packages/db/migrations` });

  const dir = `${root}/packages/data/snapshots/`;
  const file = readdirSync(dir)
    .filter((f) => f.startsWith("sp500-"))
    .sort()
    .at(-1)!;
  await loadConstituents(db, JSON.parse(readFileSync(`${dir}${file}`, "utf8")) as Constituent[]);

  const summary = await seedDemoData(db);
  await close();
  console.log(`demo database "${name}" ready`, summary);
  console.log(`DATABASE_URL=${url.toString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
