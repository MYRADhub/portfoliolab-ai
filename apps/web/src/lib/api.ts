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
 * Asks the server for the anonymous session cookie. Every caller on the page shares one request: two simultaneous
 * requests on a first visit would create two sessions, and whichever cookie arrived last would orphan the other's data.
 */
export function ensureSession(): Promise<void> {
  sessionReady ??= fetch("/api/session", { method: "POST" })
    .then(() => undefined)
    .catch(() => {
      sessionReady = null;
    });
  return sessionReady;
}

/** Used after a 401, when the cookie was lost or expired: forget the cached request and make a fresh one. */
function renewSession(): Promise<void> {
  sessionReady = null;
  return ensureSession();
}

/**
 * Fetches JSON. A 401 usually means the anonymous session cookie has not been issued yet (first visit) or has
 * expired, so renew the session and retry once before giving up.
 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res = await fetch(url, init);
  if (res.status === 401 && url !== "/api/session") {
    await renewSession();
    res = await fetch(url, init);
  }
  const body = (await res.json().catch(() => null)) as
    { error?: { code: string; message: string } } | T | null;
  if (!res.ok) {
    const e = (body as { error?: { code: string; message: string } } | null)?.error;
    throw new ApiError(e?.code ?? "internal", e?.message ?? "Request failed", res.status);
  }
  return body as T;
}
