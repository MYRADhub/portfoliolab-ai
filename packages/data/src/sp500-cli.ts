// Usage: tsx src/sp500-cli.ts [--file snapshots/sp500-YYYY-MM-DD.json] [--refresh]
// Without flags, loads the newest committed snapshot. --refresh fetches Wikipedia and writes a new dated snapshot.
import { parseArgs } from "node:util";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDb } from "@portfolio-lab/db";
import { loadConstituents, parseSp500Wikitext, type Constituent } from "./sp500";

const { values } = parseArgs({
  options: { file: { type: "string" }, refresh: { type: "boolean", default: false } },
});
const dir = fileURLToPath(new URL("../snapshots/", import.meta.url));

async function fetchLive(): Promise<Constituent[]> {
  const res = await fetch(
    "https://en.wikipedia.org/w/index.php?title=List_of_S%26P_500_companies&action=raw",
    {
      headers: { "user-agent": "portfolio-lab research (contact: quants@algoconnect.com)" },
    },
  );
  if (!res.ok) throw new Error(`Wikipedia returned HTTP ${res.status}`);
  return parseSp500Wikitext(await res.text());
}

let items: Constituent[];
if (values.refresh) {
  items = await fetchLive();
  if (items.length < 480 || items.length > 520)
    throw new Error(`unexpected constituent count ${items.length}`);
  const file = `${dir}sp500-${new Date().toISOString().slice(0, 10)}.json`;
  await writeFile(file, JSON.stringify(items, null, 2) + "\n");
  console.log(`wrote ${file}`);
} else {
  const file =
    values.file ??
    `${dir}${
      (await readdir(dir))
        .filter((f) => /^sp500-.*\.json$/.test(f))
        .sort()
        .at(-1) ??
      (() => {
        throw new Error("no snapshot found; run with --refresh");
      })()
    }`;
  items = JSON.parse(await readFile(file, "utf8")) as Constituent[];
  console.log(`loaded snapshot ${file}`);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db, close } = createDb(url);
const n = await loadConstituents(db, items);
await close();
console.log(`upserted ${n} companies`);
