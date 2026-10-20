// Usage: tsx src/aliases-cli.ts
// Regenerates company name aliases from the companies table. Idempotent.
import { createDb } from "@portfolio-lab/db";
import { syncAliases } from "./matching/store";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, close } = createDb(url);
const n = await syncAliases(db);
await close();
console.log(`synced ${n} aliases`);
