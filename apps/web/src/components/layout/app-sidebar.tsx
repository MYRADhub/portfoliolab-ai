"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Pages that need the whole screen open with the sidebar folded to an icon rail. */
const RAIL_PAGES = ["/terminal"];

/** Hides a sidebar label on the icon rail but keeps it for screen readers. */
export const RAIL_LABEL = "md:group-data-[rail=true]/sidebar:sr-only";
/** Hides an element entirely on the icon rail. */
export const RAIL_HIDDEN = "md:group-data-[rail=true]/sidebar:hidden";

/**
 * The sidebar frame. From the md breakpoint up it folds to a narrow icon rail on full-screen pages such as the
 * Terminal; a button expands or folds it, and the choice holds until the next page.
 */
export function AppSidebar({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState("");
  const [choice, setChoice] = useState<{ path: string; rail: boolean } | null>(null);
  const auto = RAIL_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
  const rail = choice && choice.path === path ? choice.rail : auto;
  return (
    <aside
      data-rail={rail}
      className={cn(
        "group/sidebar flex shrink-0 flex-col gap-3 border-b bg-sidebar p-3 text-sidebar-foreground print:hidden md:sticky md:top-0 md:h-screen md:overflow-y-auto md:border-r md:border-b-0",
        rail ? "md:w-14 md:items-center md:px-2 md:py-3" : "md:w-60 md:p-4",
      )}
    >
      <Suspense fallback={null}>
        <PathReporter onPath={setPath} />
      </Suspense>
      <button
        type="button"
        onClick={() => setChoice({ path, rail: !rail })}
        aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!rail}
        title={rail ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "hidden rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground md:flex",
          rail ? "order-first" : "self-end -mb-2",
        )}
      >
        {rail ? (
          <PanelLeftOpen className="size-4" aria-hidden="true" />
        ) : (
          <PanelLeftClose className="size-4" aria-hidden="true" />
        )}
      </button>
      {children}
    </aside>
  );
}

function PathReporter({ onPath }: { onPath: (p: string) => void }) {
  const pathname = usePathname();
  useEffect(() => onPath(pathname), [pathname, onPath]);
  return null;
}
