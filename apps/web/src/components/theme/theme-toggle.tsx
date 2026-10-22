"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { THEME_KEY } from "./theme";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

const isDark = () => document.documentElement.classList.contains("dark");

/** The page's own class is the single source of truth, so every component and tab agrees. */
export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    const next = !isDark();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // Storage can be blocked; the choice then lasts until the page is closed.
    }
    listeners.forEach((l) => l());
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      aria-pressed={dark}
      className="w-full justify-start"
    >
      {dark ? (
        <Moon className="size-3.5" aria-hidden="true" />
      ) : (
        <Sun className="size-3.5" aria-hidden="true" />
      )}
      Dark mode: {dark ? "on" : "off"}
    </Button>
  );
}
