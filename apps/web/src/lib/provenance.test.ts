import { describe, expect, it } from "vitest";
import { exposureProvenance } from "./provenance";

describe("exposureProvenance", () => {
  it("reads the label written when the score was stored", () => {
    expect(exposureProvenance("AI-drafted, not reviewed: sells chips to data centres.")).toBe(
      "draft",
    );
    expect(exposureProvenance("Demo data: illustrative only, not reviewed.")).toBe("illustrative");
    expect(exposureProvenance("Reviewed by a person.")).toBe("reviewed");
  });

  it("treats a missing rationale as reviewed only because nothing marks it otherwise", () => {
    expect(exposureProvenance(null)).toBe("reviewed");
    expect(exposureProvenance(undefined)).toBe("reviewed");
    expect(exposureProvenance("")).toBe("reviewed");
  });
});
