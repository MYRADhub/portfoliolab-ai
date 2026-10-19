import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@portfolio-lab/db/testing";
import { resolveSession } from "./session";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb();
});
afterAll(async () => {
  await ctx.teardown();
});

describe("resolveSession", () => {
  it("creates a session when there is no cookie", async () => {
    const s = await resolveSession(ctx.db, undefined);
    expect(s.created).toBe(true);
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reuses an existing session", async () => {
    const first = await resolveSession(ctx.db, undefined);
    const again = await resolveSession(ctx.db, first.id);
    expect(again).toEqual({ id: first.id, created: false });
  });

  it("replaces malformed and unknown cookie values", async () => {
    const bad = await resolveSession(ctx.db, "not-a-uuid");
    expect(bad.created).toBe(true);
    const unknown = await resolveSession(ctx.db, "00000000-0000-4000-8000-000000000000");
    expect(unknown.created).toBe(true);
    expect(unknown.id).not.toBe("00000000-0000-4000-8000-000000000000");
  });
});
