import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, route, type ErrorBody } from "./errors";

const req = (headers: Record<string, string> = {}) => new Request("http://x/api/t", { headers });

describe("route", () => {
  it("passes through successful responses and sets a request id", async () => {
    const res = await route(async () => Response.json({ ok: true }))(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("reuses an incoming request id", async () => {
    const res = await route(async () => Response.json({}))(req({ "x-request-id": "abc" }));
    expect(res.headers.get("x-request-id")).toBe("abc");
  });

  it("maps AppError to its status and message", async () => {
    const res = await route(async () => {
      throw new AppError("not_found", "Portfolio not found");
    })(req());
    const body = (await res.json()) as ErrorBody;
    expect(res.status).toBe(404);
    expect(body.error).toMatchObject({ code: "not_found", message: "Portfolio not found" });
  });

  it("maps ZodError to 400 with issue details", async () => {
    const res = await route(async () => {
      z.object({ weight: z.number() }).parse({ weight: "x" });
      return Response.json({});
    })(req());
    const body = (await res.json()) as ErrorBody;
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("bad_request");
    expect(body.error.details).toEqual([expect.objectContaining({ path: "weight" })]);
  });

  it("hides internal error messages", async () => {
    const res = await route(async () => {
      throw new Error("connection string postgres://secret");
    })(req());
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("secret");
  });
});
