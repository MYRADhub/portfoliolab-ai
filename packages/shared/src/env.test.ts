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

  it("needs only the database: the analytics service and AI settings are optional", () => {
    const e = loadEnv({ DATABASE_URL: base.DATABASE_URL });
    expect(e.ANALYTICS_URL).toBeUndefined();
    expect(e.AI_ENABLED).toBeUndefined();
    expect(e.AI_LIMIT_SCALE).toBeUndefined();
  });

  it("reads the AI switch and allowance scale", () => {
    const e = loadEnv({ ...base, AI_ENABLED: "0", AI_LIMIT_SCALE: "2.5" });
    expect(e.AI_ENABLED).toBe("0");
    expect(e.AI_LIMIT_SCALE).toBe(2.5);
    expect(() => loadEnv({ ...base, AI_LIMIT_SCALE: "-1" })).toThrow(/AI_LIMIT_SCALE/);
    expect(() => loadEnv({ ...base, AI_ENABLED: "yes" })).toThrow(/AI_ENABLED/);
  });

  it("rejects a malformed URL", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });
});
