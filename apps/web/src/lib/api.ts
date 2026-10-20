export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let sessionReady: Promise<void> | null = null;

/**
 * Makes sure the anonymous session cookie exists before the first data request, so a first visit does not begin
 * with a 401. Shared across callers so it runs once per page load.
 */
export function ensureSession(): Promise<void> {
  sessionReady ??= fetch("/api/session", { method: "POST" })
    .then(() => undefined)
    .catch(() => {
      sessionReady = null;
    });
  return sessionReady;
}

/**
 * Fetches JSON. A 401 usually means the anonymous session cookie has not been issued yet (first visit) or has
 * expired, so create a session and retry once before giving up.
 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res = await fetch(url, init);
  if (res.status === 401 && url !== "/api/session") {
    const session = await fetch("/api/session", { method: "POST" });
    if (session.ok) res = await fetch(url, init);
  }
  const body = (await res.json().catch(() => null)) as
    { error?: { code: string; message: string } } | T | null;
  if (!res.ok) {
    const e = (body as { error?: { code: string; message: string } } | null)?.error;
    throw new ApiError(e?.code ?? "internal", e?.message ?? "Request failed", res.status);
  }
  return body as T;
}
