import { createDb } from "../client";
import { seedDevCompanies } from "./companies";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const { db, close } = createDb(url);
await seedDevCompanies(db);
await close();
console.log("seed complete");
