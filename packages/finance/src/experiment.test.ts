import { describe, expect, it } from "vitest";
import {
  assignArm,
  compareArms,
  effectiveBets,
  normalQuantile,
  requiredPerArm,
  symmetricEigen,
} from "./index";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("assignArm", () => {
  it("gives the next participant to the smaller arm and breaks ties by the random draw", () => {
    expect(assignArm({ control: 2, treatment: 3 }, 0.99)).toBe("control");
    expect(assignArm({ control: 4, treatment: 3 }, 0.01)).toBe("treatment");
    expect(assignArm({ control: 3, treatment: 3 }, 0.2)).toBe("control");
    expect(assignArm({ control: 3, treatment: 3 }, 0.7)).toBe("treatment");
  });

  it("keeps the arms within one of each other over any sequence of draws", () => {
    let s = 12345;
    const draw = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const counts = { control: 0, treatment: 0 };
    for (let i = 0; i < 501; i++) {
      counts[assignArm(counts, draw())]++;
      expect(Math.abs(counts.control - counts.treatment)).toBeLessThanOrEqual(1);
    }
  });
});

describe("normalQuantile and requiredPerArm", () => {
  it("matches standard normal table values", () => {
    close(normalQuantile(0.975), 1.959963985, 1e-6);
    close(normalQuantile(0.8), 0.841621234, 1e-6);
    close(normalQuantile(0.5), 0, 1e-12);
    close(normalQuantile(0.01), -normalQuantile(0.99), 1e-9);
    expect(() => normalQuantile(0)).toThrow();
  });

  it("reproduces textbook sample sizes", () => {
    // d = 0.5, alpha 0.05, power 0.8: 2 * (2.8016 / 0.5)^2 = 62.8, so 63 per arm
    expect(requiredPerArm(0.5)).toBe(63);
    expect(requiredPerArm(0.8)).toBe(25); // 2 * (2.8016 / 0.8)^2 = 24.5
    expect(requiredPerArm(0.5, 0.05, 0.9)).toBe(85); // z = 1.96 + 1.2816
    expect(requiredPerArm(0.2)).toBeGreaterThan(requiredPerArm(0.5));
    expect(() => requiredPerArm(0)).toThrow();
  });
});

describe("compareArms", () => {
  it("matches a hand calculation of the difference, Welch t and Cohen's d", () => {
    // control 1,2,3 (mean 2, var 1); treatment 3,4,5 (mean 4, var 1); se = sqrt(1/3 + 1/3)
    const r = compareArms([1, 2, 3], [3, 4, 5]);
    close(r.difference, 2);
    close(r.t!, 2 / Math.sqrt(2 / 3));
    close(r.cohensD!, 2);
    expect(r).toMatchObject({ nControl: 3, nTreatment: 3, meanControl: 2, meanTreatment: 4 });
  });

  it("gives an exact permutation p-value for a tiny case", () => {
    // 3 vs 3 fully separated: 2 of the 20 splits are as extreme (both directions), so p near 0.1
    const r = compareArms([1, 2, 3], [4, 5, 6], { resamples: 20_000 });
    expect(Math.abs(r.permutationP! - 0.1)).toBeLessThan(0.01);
  });

  it("finds a large difference significant and no difference not significant, repeatably", () => {
    const a = Array.from({ length: 40 }, (_, i) => 0.3 + 0.01 * Math.sin(i));
    const b = Array.from({ length: 40 }, (_, i) => 0.2 + 0.01 * Math.cos(i));
    expect(compareArms(a, b).permutationP!).toBeLessThan(0.01);
    const same = compareArms(
      a,
      a.map((v) => v + 1e-12),
    );
    expect(same.permutationP!).toBeGreaterThan(0.5);
    expect(compareArms(a, b)).toEqual(compareArms(a, b));
  });

  it("handles arms that are too small or have no variance", () => {
    const one = compareArms([1], [2]);
    expect(one.t).toBeNull();
    expect(one.cohensD).toBeNull();
    expect(one.permutationP).not.toBeNull();
    const flat = compareArms([1, 1], [2, 2]);
    expect(flat.t).toBeNull();
    expect(compareArms([], [1, 2]).permutationP).toBeNull();
  });
});

describe("symmetricEigen", () => {
  it("recovers a known decomposition and keeps the vectors orthonormal", () => {
    const { values, vectors } = symmetricEigen([
      [2, 1],
      [1, 2],
    ]);
    expect([...values].sort((a, b) => a - b).map((x) => +x.toFixed(10))).toEqual([1, 3]);
    const dot = vectors[0]![0]! * vectors[0]![1]! + vectors[1]![0]! * vectors[1]![1]!;
    expect(Math.abs(dot)).toBeLessThan(1e-12);
  });

  it("reproduces the matrix from its eigenvectors", () => {
    const m = [
      [4, 1, 0.5],
      [1, 3, 0.2],
      [0.5, 0.2, 1],
    ];
    const { values, vectors } = symmetricEigen(m);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const back = values.reduce((s, l, k) => s + l * vectors[i]![k]! * vectors[j]![k]!, 0);
        expect(Math.abs(back - m[i]![j]!)).toBeLessThan(1e-10);
      }
  });
});

describe("effectiveBets", () => {
  it("equals the number of holdings for equal weights on independent, equally risky assets", () => {
    const cov = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    expect(effectiveBets([0.25, 0.25, 0.25, 0.25], cov)).toBeCloseTo(4, 10);
  });

  it("is close to 1 when the assets are almost perfectly correlated", () => {
    const cov = [
      [1, 0.999, 0.999],
      [0.999, 1, 0.999],
      [0.999, 0.999, 1],
    ];
    expect(effectiveBets([1 / 3, 1 / 3, 1 / 3], cov)!).toBeLessThan(1.01);
  });

  it("falls when weight is concentrated, and is null without variance", () => {
    const cov = [
      [1, 0],
      [0, 1],
    ];
    expect(effectiveBets([0.9, 0.1], cov)!).toBeLessThan(effectiveBets([0.5, 0.5], cov)!);
    expect(
      effectiveBets(
        [0.5, 0.5],
        [
          [0, 0],
          [0, 0],
        ],
      ),
    ).toBeNull();
    expect(() => effectiveBets([1], cov)).toThrow();
  });
});
