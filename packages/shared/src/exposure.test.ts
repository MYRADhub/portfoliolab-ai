import { describe, expect, it } from "vitest";
import { exposureSchema, signedExposure } from "./exposure";

describe("exposure", () => {
  it("computes signed exposure", () => {
    expect(signedExposure({ magnitude: 3, direction: -1 })).toBe(-3);
    expect(signedExposure({ magnitude: 2, direction: 1 })).toBe(2);
    expect(signedExposure({ magnitude: 0, direction: 0 })).toBe(0);
  });

  it("rejects out-of-range magnitude and invalid direction", () => {
    expect(exposureSchema.safeParse({ magnitude: 4, direction: 1 }).success).toBe(false);
    expect(exposureSchema.safeParse({ magnitude: 1, direction: 2 }).success).toBe(false);
    expect(exposureSchema.safeParse({ magnitude: 1.5, direction: 1 }).success).toBe(false);
  });
});
