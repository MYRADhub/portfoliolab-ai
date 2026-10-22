"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { markVisited } from "@/lib/onboarding";

/** Remembers which pages have been opened so the getting-started checklist can tick them off. */
export function ProgressTracker() {
  const pathname = usePathname();
  useEffect(() => {
    markVisited(pathname.split("/").slice(0, 2).join("/") || "/");
  }, [pathname]);
  return null;
}
