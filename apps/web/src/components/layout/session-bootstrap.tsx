"use client";

import { useEffect } from "react";

/** Ensures an anonymous session cookie exists. Safe to call on every load. */
export function SessionBootstrap() {
  useEffect(() => {
    void fetch("/api/session", { method: "POST" }).catch(() => undefined);
  }, []);
  return null;
}
