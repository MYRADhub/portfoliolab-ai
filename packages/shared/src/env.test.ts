import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  ANALYTICS_URL: "http://localhost:8000",
};

describe("loadEnv", () => {
  it("accepts required vars and treats provider keys as optional", () => {
    expect(loadEnv(base).TIINGO_API_KEY).toBeUndefined();
  });

  it("treats empty strings as unset", () => {
    expect(loadEnv({ ...base, TIINGO_API_KEY: "" }).TIINGO_API_KEY).toBeUndefined();
  });

  it("throws listing the missing variable", () => {
    expect(() => loadEnv({ ANALYTICS_URL: base.ANALYTICS_URL })).toThrow(/DATABASE_URL/);
  });

  it("rejects a malformed URL", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });
});
