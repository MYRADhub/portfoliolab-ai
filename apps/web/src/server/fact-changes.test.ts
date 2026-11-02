import { describe, expect, it } from "vitest";
import { compareFacts, factKey } from "./fact-changes";

describe("compareFacts", () => {
  it("matches figures by label with dates ignored and reports changed, new, gone and same", () => {
    const before = [
      { id: "F1", label: "NVDA close on 2026-10-26", text: "$180.00" },
      { id: "F2", label: "NVDA sector", text: "Information Technology" },
      { id: "F3", label: "NVDA return over 1 month", text: "+4.0%" },
      { id: "F4", label: "Old headline", text: "Something" },
    ];
    const after = [
      { id: "F1", label: "NVDA close on 2026-11-02", text: "$186.50" },
      { id: "F2", label: "NVDA sector", text: "Information Technology" },
      { id: "F3", label: "NVDA return over 1 month", text: "+6.1%" },
      { id: "F4", label: "New filing passage", text: "Text" },
      { id: "F5", label: "NVDA sector", text: "duplicate is ignored" },
    ];
    expect(compareFacts(before, after)).toEqual({
      changed: [
        { label: "NVDA close on 2026-11-02", before: "$180.00", after: "$186.50" },
        { label: "NVDA return over 1 month", before: "+4.0%", after: "+6.1%" },
      ],
      added: [{ label: "New filing passage", text: "Text" }],
      removed: [{ label: "Old headline", text: "Something" }],
      unchanged: 1,
    });
  });

  it("normalizes case and spacing in keys", () => {
    expect(factKey("  NVDA  Close on 2026-01-02 ")).toBe("nvda close on <date>");
  });
});
