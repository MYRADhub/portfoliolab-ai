"use client";

import { useSyncExternalStore } from "react";

const KEY = "pl-onboarding";

export interface OnboardingState {
  /** The first-visit welcome card was dismissed. */
  welcomeDismissed: boolean;
  /** The getting-started checklist was hidden. */
  checklistHidden: boolean;
  /** The guided tour was finished or skipped. */
  tourDone: boolean;
  /** "Don't start the tour automatically" was ticked; the Tutorial button still starts it. */
  tourOptOut: boolean;
  /** Pages visited, used to tick the checklist. */
  visited: string[];
}

const EMPTY: OnboardingState = {
  welcomeDismissed: false,
  checklistHidden: false,
  tourDone: false,
  tourOptOut: false,
  visited: [],
};

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: OnboardingState } | null = null;

function read(): OnboardingState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage can be blocked; progress then lasts only for this page view.
    return memory;
  }
  if (cache && cache.raw === raw) return cache.value;
  let value = EMPTY;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<OnboardingState>;
      value = {
        welcomeDismissed: parsed.welcomeDismissed === true,
        checklistHidden: parsed.checklistHidden === true,
        tourDone: parsed.tourDone === true,
        tourOptOut: parsed.tourOptOut === true,
        visited: Array.isArray(parsed.visited)
          ? parsed.visited.filter((v) => typeof v === "string")
          : [],
      };
    } catch {
      value = EMPTY;
    }
  }
  cache = { raw, value };
  return value;
}

let memory: OnboardingState = EMPTY;

/** Merges a change into the stored state and tells every subscribed component. */
export function updateOnboarding(patch: Partial<OnboardingState>): void {
  const next = { ...read(), ...patch };
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    cache = null;
  }
  listeners.forEach((l) => l());
}

export function markVisited(path: string): void {
  const current = read();
  if (!current.visited.includes(path)) updateOnboarding({ visited: [...current.visited, path] });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** The stored onboarding state, read outside React (for example when deciding to start the tour). */
export function getOnboarding(): OnboardingState {
  return read();
}

const VISIT_KEY = "pl-tour-this-visit";
let shownThisPageLoad = false;

/**
 * Whether the tour has already started by itself during this visit (this browser tab), and marks it as started.
 * A visit lasts until the tab is closed. With session storage blocked, it falls back to this page load.
 */
export function claimAutoTour(): boolean {
  try {
    if (sessionStorage.getItem(VISIT_KEY)) return false;
    sessionStorage.setItem(VISIT_KEY, "1");
    return true;
  } catch {
    if (shownThisPageLoad) return false;
    shownThisPageLoad = true;
    return true;
  }
}

/** Onboarding progress, shared by the welcome card, the checklist, the tour and the sidebar. Null until the browser has read storage. */
export function useOnboarding(): OnboardingState | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
