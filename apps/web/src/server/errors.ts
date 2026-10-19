import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { logger } from "./logger";

export type ErrorCode = "bad_request" | "unauthorized" | "not_found" | "conflict" | "internal";

const statusByCode: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  internal: 500,
};

/** Error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; requestId: string; details?: unknown };
}

type Handler = (req: Request, requestId: string) => Promise<Response>;

/** Wraps a route handler: assigns a request id, logs, and maps errors to a stable JSON shape. */
export function route(handler: Handler) {
  return async (req: Request): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const started = Date.now();
    try {
      const res = await handler(req, requestId);
      res.headers.set("x-request-id", requestId);
      logger.info({
        requestId,
        method: req.method,
        url: new URL(req.url).pathname,
        status: res.status,
        ms: Date.now() - started,
      });
      return res;
    } catch (err) {
      return toErrorResponse(err, requestId, req);
    }
  };
}

function toErrorResponse(err: unknown, requestId: string, req: Request): Response {
  let code: ErrorCode = "internal";
  let message = "Something went wrong";
  let details: unknown;

  if (err instanceof AppError) {
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    code = "bad_request";
    message = "Invalid request";
    details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  } else {
    logger.error({ requestId, err, method: req.method, url: new URL(req.url).pathname });
  }

  const body: ErrorBody = { error: { code, message, requestId, ...(details ? { details } : {}) } };
  return Response.json(body, {
    status: statusByCode[code],
    headers: { "x-request-id": requestId },
  });
}
