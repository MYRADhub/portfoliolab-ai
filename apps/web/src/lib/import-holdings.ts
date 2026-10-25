/**
 * Reads holdings pasted from a spreadsheet or exported from a broker. Understands plain lists ("AAPL 25%"), CSV and tab
 * separated tables with headers (Symbol, Quantity, Market Value, Weight and common variants), dollar signs, thousands
 * separators, percent signs and negative numbers in parentheses. Nothing here touches the network or the database.
 */

export type ImportKind = "weights" | "values" | "shares";

export interface ParsedHolding {
  ticker: string;
  amount: number;
}

export interface SkippedLine {
  line: number;
  text: string;
  reason: string;
}

export interface ParsedImport {
  holdings: ParsedHolding[];
  /** What the numbers appear to be: percentages, dollar values or share counts. */
  kind: ImportKind;
  skipped: SkippedLine[];
  /** Tickers that appeared more than once and were added together. */
  merged: string[];
}

const TICKER = /^[A-Z][A-Z0-9]{0,5}(\.[A-Z])?$/;
const NOT_A_HOLDING = /^(TOTAL|TOTALS|CASH|SUBTOTAL|PENDING|ACCOUNT|GRAND|BALANCE|N\/A|--)\b/i;

/** Brokers write share classes many ways; our canonical form is BRK.B. */
export function normalizeTicker(raw: string): string | null {
  let t = raw.trim().toUpperCase().replace(/^\$/, "");
  t = t.replace(/^[A-Z]+:/, ""); // exchange prefix, e.g. NASDAQ:AAPL
  t = t.replace(/[-/ ]([A-Z])$/, ".$1"); // BRK-B, BRK/B, BRK B
  t = t.replace(/\*+$/, "");
  return TICKER.test(t) ? t : null;
}

/** Splits one line, honouring double quotes so "1,234.50" stays whole. */
function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "ws") return line.trim().split(/\s+/);
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function detectDelimiter(lines: string[]): string {
  // Commas inside numbers ($5,000) are thousands separators, not column separators.
  const sample = lines
    .slice(0, 10)
    .join("\n")
    .replace(/\d,(?=\d{3}\b)/g, "");
  const count = (ch: string) =>
    (sample.match(new RegExp(ch === "\t" ? "\\t" : `\\${ch}`, "g")) ?? []).length;
  if (count("\t") >= lines.slice(0, 10).length) return "\t";
  const comma = count(",");
  const semi = count(";");
  if (semi > comma && semi >= 1) return ";";
  if (comma >= Math.max(1, Math.min(lines.length, 10) - 1)) return ",";
  return "ws";
}

/** A number as people write it: $1,234.50, 12.5%, (300) for negative, 1 234. Null if it is not a number. */
export function parseAmount(
  raw: string,
): { value: number; percent: boolean; dollar: boolean } | null {
  let s = raw.trim();
  if (!s) return null;
  const percent = s.includes("%");
  const dollar = s.includes("$");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$%\s]/g, "");
  // thousands separators: 1,234.50 or 1,234
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const value = Number(s) * (negative ? -1 : 1);
  return Number.isFinite(value) ? { value, percent, dollar } : null;
}

const HEADER_WORDS =
  /symbol|ticker|security|instrument|quantity|shares|units|qty|weight|allocation|value|amount|percent|%/i;

function columnKind(name: string): "ticker" | ImportKind | null {
  const n = name.toLowerCase();
  if (/^(symbol|ticker|security|instrument|stock)\b/.test(n)) return "ticker";
  if (/weight|allocation|% of|percent|portfolio %|pct/.test(n)) return "weights";
  if (
    /market value|current value|value|amount|total|balance/.test(n) &&
    !/price|cost|gain|change/.test(n)
  )
    return "values";
  if (/quantity|shares|units|qty/.test(n)) return "shares";
  return null;
}

export function parseHoldings(text: string): ParsedImport {
  const skipped: SkippedLine[] = [];
  const raw = text.replace(/^﻿/, "").split(/\r?\n/);
  const lines = raw.map((t, i) => ({ t: t.trim(), n: i + 1 })).filter((l) => l.t);
  const empty: ParsedImport = { holdings: [], kind: "weights", skipped, merged: [] };
  if (lines.length === 0) return empty;

  const delimiter = detectDelimiter(lines.map((l) => l.t));
  const cells = lines.map((l) => ({ ...l, cells: splitLine(l.t, delimiter) }));

  // A header row has words like Symbol or Quantity and no number in it.
  let tickerCol = 0;
  let valueCol = 1;
  let headerKind: ImportKind | null = null;
  let start = 0;
  const first = cells[0]!.cells;
  if (first.some((c) => HEADER_WORDS.test(c)) && !first.some((c) => parseAmount(c) !== null)) {
    const kinds = first.map(columnKind);
    const t = kinds.indexOf("ticker");
    if (t >= 0) tickerCol = t;
    // prefer weights, then values, then shares when several columns are present
    for (const k of ["weights", "values", "shares"] as const) {
      const idx = kinds.indexOf(k);
      if (idx >= 0) {
        valueCol = idx;
        headerKind = k;
        break;
      }
    }
    start = 1;
  }

  const rows: { ticker: string; amount: number; percent: boolean; dollar: boolean }[] = [];
  for (const row of cells.slice(start)) {
    const tickerRaw = row.cells[tickerCol] ?? "";
    if (NOT_A_HOLDING.test(tickerRaw)) {
      skipped.push({ line: row.n, text: row.t, reason: "Not a holding" });
      continue;
    }
    const ticker = normalizeTicker(tickerRaw);
    if (!ticker) {
      skipped.push({ line: row.n, text: row.t, reason: `"${tickerRaw}" is not a ticker` });
      continue;
    }
    // Take the chosen column; for headerless rows take the first cell after the ticker that is a number.
    const candidates = headerKind
      ? [row.cells[valueCol] ?? ""]
      : row.cells.filter((_, i) => i !== tickerCol);
    const amount = candidates.map(parseAmount).find((a) => a !== null) ?? null;
    if (!amount) {
      skipped.push({ line: row.n, text: row.t, reason: "No number found" });
      continue;
    }
    if (amount.value <= 0) {
      skipped.push({
        line: row.n,
        text: row.t,
        reason: "Short or zero positions are not supported",
      });
      continue;
    }
    rows.push({ ticker, amount: amount.value, percent: amount.percent, dollar: amount.dollar });
  }

  const byTicker = new Map<string, number>();
  const merged = new Set<string>();
  for (const r of rows) {
    if (byTicker.has(r.ticker)) merged.add(r.ticker);
    byTicker.set(r.ticker, (byTicker.get(r.ticker) ?? 0) + r.amount);
  }
  const holdings = [...byTicker.entries()].map(([ticker, amount]) => ({ ticker, amount }));

  let kind: ImportKind;
  if (headerKind) kind = headerKind;
  else if (rows.length > 0 && rows.every((r) => r.percent)) kind = "weights";
  else if (rows.length > 0 && rows.every((r) => r.dollar)) kind = "values";
  else {
    const total = holdings.reduce((a, h) => a + h.amount, 0);
    kind =
      Math.abs(total - 100) <= 1 && holdings.every((h) => h.amount <= 100) ? "weights" : "shares";
  }
  return { holdings, kind, skipped, merged: [...merged] };
}
