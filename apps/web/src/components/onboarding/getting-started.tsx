"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { updateOnboarding, useOnboarding } from "@/lib/onboarding";
import { useTour } from "./tour";

const ITEMS: { key: string; label: string; href: string }[] = [
  { key: "/dashboard", label: "Open your dashboard", href: "/dashboard" },
  { key: "/exposures", label: "See your hidden exposures", href: "/exposures" },
  { key: "/stress", label: "Run a stress test", href: "/stress" },
  { key: "/news", label: "Check what the news means for you", href: "/news" },
  { key: "/research", label: "Ask the assistant a question", href: "/research" },
  { key: "tour", label: "Take the guided tour", href: "/dashboard" },
];

/** A getting-started checklist that ticks itself off as pages are opened. The tour opens by itself each visit. */
export function GettingStarted() {
  const state = useOnboarding();
  const { start } = useTour();
  if (!state) return null;

  if (state.checklistHidden) return null;
  const visited = new Set(state.visited);
  const done = ITEMS.filter((i) => visited.has(i.key)).length;
  if (done === ITEMS.length) return null;

  return (
    <Card role="region" aria-label="Getting started">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Getting started</p>
            <p className="text-xs text-muted-foreground" data-testid="checklist-progress">
              {done} of {ITEMS.length} done
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateOnboarding({ checklistHidden: true })}
          >
            <X aria-hidden="true" />
            Hide checklist
          </Button>
        </div>
        <div className="h-1.5 rounded-full bg-muted" aria-hidden="true">
          <div
            className="h-1.5 rounded-full bg-primary transition-all"
            style={{ width: `${(done / ITEMS.length) * 100}%` }}
          />
        </div>
        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Checklist">
          {ITEMS.map((item) => {
            const complete = visited.has(item.key);
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  onClick={
                    item.key === "tour"
                      ? (e) => {
                          e.preventDefault();
                          start();
                        }
                      : undefined
                  }
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${complete ? "border-gain bg-gain-soft text-gain" : "text-transparent"}`}
                  >
                    <Check className="size-3" />
                  </span>
                  <span className={complete ? "text-muted-foreground line-through" : ""}>
                    {item.label}
                  </span>
                  <span className="sr-only">{complete ? "(completed)" : "(not yet done)"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
