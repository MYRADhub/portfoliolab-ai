"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand";

/**
 * The sidebar's frame. On a phone the navigation is folded behind a menu button so the page itself starts on the first
 * screen; from the md breakpoint up it is always visible. Choosing a link closes the menu.
 */
export function SidebarShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between gap-2.5 md:mb-4">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight">PortfolioLab</div>
            <div className="text-[0.7rem] text-muted-foreground">Research the hidden risks</div>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="sidebar-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
          className="rounded-md border p-2 hover:bg-sidebar-accent/60 md:hidden"
        >
          {open ? (
            <X className="size-4" aria-hidden="true" />
          ) : (
            <Menu className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <div
        id="sidebar-menu"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
        className={cn(open ? "flex" : "hidden", "flex-col gap-3 md:flex md:flex-1")}
      >
        {children}
      </div>
    </>
  );
}
