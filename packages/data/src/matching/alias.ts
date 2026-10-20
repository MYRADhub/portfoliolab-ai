export interface GeneratedAlias {
  alias: string;
  kind: "name";
  ambiguous: boolean;
}

/**
 * Single-word company names that are also common words or other well-known entities. A match on one of these
 * alone is weak evidence. Reviewable judgment list; extend as false positives are found.
 */
export const AMBIGUOUS_NAMES: ReadonlySet<string> = new Set([
  "Ball",
  "Block",
  "Booking",
  "Carnival",
  "Coherent",
  "Dover",
  "Dow",
  "Flex",
  "Fox",
  "Mosaic",
  "News",
  "Northern",
  "Progressive",
  "Southern",
  "Tapestry",
  "Target",
  "Visa",
]);

const LEGAL_SUFFIX =
  /(,?\s+(?:&\s+)?(Inc\.?|Corp\.?|Corporation|Co\.?|Company|Companies|Ltd\.?|plc|PLC|Holdings|Group|Incorporated|Limited|N\.V\.|S\.A\.|LLC|L\.P\.|Trust))+\s*$/;

/** Short, text-friendly names for a registered company name. */
export function generateAliases(registeredName: string): GeneratedAlias[] {
  let name = registeredName.replace(/\s*\([^)]*\)/g, "").trim();
  name = name.replace(/^The\s+/i, "");
  name = name
    .replace(LEGAL_SUFFIX, "")
    .replace(/[\s,.]+$/, "")
    .trim();
  if (!name) return [];
  const out = new Map<string, GeneratedAlias>();
  const add = (alias: string) =>
    out.set(alias, {
      alias,
      kind: "name",
      ambiguous: !alias.includes(" ") && AMBIGUOUS_NAMES.has(alias),
    });
  add(name);
  // "Johnson & Johnson" style names are also written with "and".
  if (name.includes(" & ")) add(name.replace(" & ", " and "));
  return [...out.values()];
}
