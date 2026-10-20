/** One computed value the explanation may cite. The model sees `text` and must reproduce numbers exactly as written. */
export interface Fact {
  id: string;
  label: string;
  text: string;
}

export function factsFromEntries(entries: readonly { label: string; text: string }[]): Fact[] {
  return entries.map((e, i) => ({ id: `F${i + 1}`, ...e }));
}
