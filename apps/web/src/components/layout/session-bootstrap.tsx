"use client";

import { useEffect } from "react";
import { ensureSession } from "@/lib/api";

/** Ensures an anonymous session cookie exists. Shares one request with every other caller on the page. */
export function SessionBootstrap() {
  useEffect(() => {
    void ensureSession();
  }, []);
  return null;
}
