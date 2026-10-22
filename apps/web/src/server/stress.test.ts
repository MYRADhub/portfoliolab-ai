import { describe, expect, it } from "vitest";
import { DEMO_FACTORS } from "@portfolio-lab/demo";
import { STRESS_PRESETS } from "./stress";

describe("stress presets", () => {
  it("only reference factors that exist in the taxonomy used by the demo data", () => {
    const known = new Set(DEMO_FACTORS.map((f) => f.slug));
    for (const p of STRESS_PRESETS)
      for (const slug of Object.keys(p.shocks)) expect(known, `${p.id}: ${slug}`).toContain(slug);
  });

  it("has unique ids and shocks within the allowed range", () => {
    expect(new Set(STRESS_PRESETS.map((p) => p.id)).size).toBe(STRESS_PRESETS.length);
    for (const p of STRESS_PRESETS)
      for (const v of Object.values(p.shocks)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });
});
