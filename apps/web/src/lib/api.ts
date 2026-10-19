export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as
    { error?: { code: string; message: string } } | T | null;
  if (!res.ok) {
    const e = (body as { error?: { code: string; message: string } } | null)?.error;
    throw new ApiError(e?.code ?? "internal", e?.message ?? "Request failed", res.status);
  }
  return body as T;
}
