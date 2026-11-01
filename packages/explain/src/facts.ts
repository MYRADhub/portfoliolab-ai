/** Where a fact came from: our own computed data, a web page, or an SEC filing. */
export type FactKind = "data" | "web" | "filing";

export interface FactSource {
  url: string;
  title?: string;
  /** Publication or filing date as the source states it, when known. */
  published?: string;
}

/** One computed value the explanation may cite. The model sees `text` and must reproduce numbers exactly as written. */
export interface Fact {
  id: string;
  label: string;
  text: string;
  /** Absent means "data": a value computed from our own database. */
  kind?: FactKind;
  source?: FactSource;
}

export function factsFromEntries(entries: readonly { label: string; text: string }[]): Fact[] {
  return entries.map((e, i) => ({ id: `F${i + 1}`, ...e }));
}
