import { describe, expect, it } from "vitest";
import { diffSections, overlap, paragraphs } from "./sec/diff";

const P = {
  supply:
    "We depend on a limited number of suppliers for advanced packaging and any disruption could delay our shipments to customers.",
  export:
    "Export controls on our products to China require licenses and could reduce our revenue from customers in that region.",
  exportNew:
    "Export controls on our products to China require licenses and could reduce our revenue from customers in that region. The government also restricted sales of our newest accelerators in the second quarter.",
  rates:
    "Changes in interest rates could affect the value of our investment portfolio and our cost of borrowing money.",
  ai: "New regulations on artificial intelligence models could require us to change how we design and sell our products.",
};

describe("filing diff", () => {
  it("keeps paragraphs and drops short headings", () => {
    const ps = paragraphs(`Risks Related to Our Industry\n${P.supply}\nShort line here`);
    expect(ps.map((p) => p.text)).toEqual([P.supply]);
  });

  it("measures word overlap", () => {
    expect(overlap(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(overlap(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3, 10);
  });

  it("finds unchanged, reworded with the new sentence, added and removed paragraphs", () => {
    const d = diffSections(
      [P.supply, P.export, P.rates].join("\n"),
      [P.supply, P.exportNew, P.ai].join("\n"),
    );
    expect(d.counts).toEqual({ unchanged: 1, reworded: 1, added: 1, removed: 1 });
    const rew = d.changes.find((c) => c.kind === "reworded")!;
    expect(rew.newSentences).toEqual([
      "The government also restricted sales of our newest accelerators in the second quarter.",
    ]);
    expect(rew.previous).toBe(P.export);
    expect(d.changes.find((c) => c.kind === "added")!.text).toBe(P.ai);
    expect(d.changes.find((c) => c.kind === "removed")!.text).toBe(P.rates);
    expect(d.words.after).toBeGreaterThan(d.words.before);
  });

  it("does not count a lightly edited sentence as new", () => {
    const added = "Customers in the Middle East now require separate approvals for each shipment.";
    const d = diffSections(P.export, `${P.export.replace("could reduce", "may reduce")} ${added}`);
    expect(d.counts.reworded).toBe(1);
    expect(d.changes[0]!.newSentences).toEqual([added]);
  });

  it("reports no changes for identical text, ignoring case and punctuation", () => {
    const d = diffSections(P.supply, P.supply.toUpperCase().replace(/,/g, ""));
    expect(d.counts).toEqual({ unchanged: 1, reworded: 0, added: 0, removed: 0 });
    expect(d.changes).toEqual([]);
  });
});
