"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

type State<T> = { key: string; data?: T; error?: string };

/** Fetches `url` whenever it changes. Returns null data while the current url is loading. */
export function useApi<T>(url: string): { data: T | null; error: string | null } {
  const [state, setState] = useState<State<T> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<T>(url)
      .then((data) => !cancelled && setState({ key: url, data }))
      .catch(
        (e) =>
          !cancelled &&
          setState({ key: url, error: e instanceof Error ? e.message : "Failed to load" }),
      );
    return () => {
      cancelled = true;
    };
  }, [url]);

  const current = state?.key === url ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? null };
}
