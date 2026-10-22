import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { toCsv, validateSelection } from "./experiment";

const universe = new Set(["A", "B", "C", "D", "E", "F"]);
const five = ["A", "B", "C", "D", "E"].map((ticker) => ({ ticker, weightPct: 20 }));

function rejection(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.message;
    throw e;
  }
  return "accepted";
}

describe("validateSelection", () => {
  it("accepts 5 to 10 distinct universe companies at 1% or more adding to 100", () => {
    expect(rejection(() => validateSelection(five, universe))).toBe("accepted");
    const uneven = [40, 30, 15, 10, 5].map((weightPct, i) => ({ ticker: "ABCDE"[i]!, weightPct }));
    expect(rejection(() => validateSelection(uneven, universe))).toBe("accepted");
  });

  it("rejects each kind of invalid selection with its own message", () => {
    expect(rejection(() => validateSelection(five.slice(0, 4), universe))).toMatch(
      /Choose 5 to 10/,
    );
    expect(rejection(() => validateSelection([...five.slice(0, 4), five[0]!], universe))).toMatch(
      /once/,
    );
    expect(
      rejection(() =>
        validateSelection([...five.slice(0, 4), { ticker: "Z", weightPct: 20 }], universe),
      ),
    ).toMatch(/not in the study universe/);
    expect(
      rejection(() =>
        validateSelection(
          five.map((h) => ({ ...h, weightPct: 19 })),
          universe,
        ),
      ),
    ).toMatch(/add up to 100/);
    const thin = [40, 30, 20, 9.5, 0.5].map((weightPct, i) => ({ ticker: "ABCDE"[i]!, weightPct }));
    expect(rejection(() => validateSelection(thin, universe))).toMatch(/at least 1%/);
  });

  it("allows a rounding error of 0.01 in the total but not more", () => {
    const near = [20, 20, 20, 20, 19.995].map((weightPct, i) => ({
      ticker: "ABCDE"[i]!,
      weightPct,
    }));
    expect(rejection(() => validateSelection(near, universe))).toBe("accepted");
    const off = [20, 20, 20, 20, 19.9].map((weightPct, i) => ({ ticker: "ABCDE"[i]!, weightPct }));
    expect(rejection(() => validateSelection(off, universe))).toMatch(/add up to 100/);
  });
});

describe("toCsv", () => {
  it("writes a header, quotes commas, quotes and newlines, and leaves numbers and blanks alone", () => {
    const out = toCsv([{ a: 1, b: "x,y", c: 'say "hi"', d: null, e: "line\nbreak", f: -2.5 }]);
    expect(out).toBe('a,b,c,d,e,f\n1,"x,y","say ""hi""",,"line\nbreak",-2.5\n');
  });

  it("neutralizes spreadsheet formulas", () => {
    const out = toCsv([{ a: "=SUM(A1)", b: "+1", c: "@cmd", d: "-cmd", e: "-3" }]);
    expect(out).toBe("a,b,c,d,e\n'=SUM(A1),'+1,'@cmd,'-cmd,-3\n");
  });

  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});
