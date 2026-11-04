"use client";

import {
  Activity,
  BookOpen,
  ChevronDown,
  Compass,
  Eye,
  FlaskConical,
  Gauge,
  FileText,
  GitCompare,
  Grid3x3,
  LayoutDashboard,
  Network,
  Newspaper,
  Radio,
  Scale,
  Search,
  SquareTerminal,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { RAIL_HIDDEN, RAIL_LABEL } from "./app-sidebar";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Marks the element for the guided tour. */
  tour: string;
}

const MAIN: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tour: "nav-dashboard" },
  { href: "/research", label: "Research", icon: Search, tour: "nav-research" },
  { href: "/news", label: "News", icon: Newspaper, tour: "nav-news" },
  { href: "/watchlist", label: "Watchlist", icon: Eye, tour: "nav-watchlist" },
  { href: "/terminal", label: "Terminal", icon: SquareTerminal, tour: "nav-terminal" },
];

const TOOLS: Item[] = [
  { href: "/exposures", label: "Exposures", icon: Network, tour: "nav-exposures" },
  { href: "/correlation", label: "Correlation", icon: Grid3x3, tour: "nav-correlation" },
  { href: "/forces", label: "What the forces did", icon: Activity, tour: "nav-forces" },
  { href: "/benchmark", label: "Market comparison", icon: Gauge, tour: "nav-benchmark" },
  { href: "/compare", label: "Compare", icon: GitCompare, tour: "nav-compare" },
  { href: "/stress", label: "Stress Lab", icon: Zap, tour: "nav-stress" },
  { href: "/discovery", label: "Discovery", icon: Compass, tour: "nav-discovery" },
  { href: "/rebalance", label: "Rebalance Lab", icon: Scale, tour: "nav-rebalance" },
  { href: "/simulation", label: "Simulation", icon: TrendingUp, tour: "nav-simulation" },
  { href: "/events", label: "Reactions", icon: Radio, tour: "nav-events" },
  { href: "/evidence", label: "Evidence", icon: FlaskConical, tour: "nav-evidence" },
];

const HELP: Item[] = [
  { href: "/report", label: "Report", icon: FileText, tour: "nav-report" },
  { href: "/guide", label: "Guide", icon: BookOpen, tour: "nav-guide" },
];

const TOOLS_KEY = "pl-nav-tools";
const TOOLS_EVENT = "pl-nav-tools-change";
let memory: boolean | null = null;

function readSaved(): boolean | null {
  try {
    const v = window.localStorage.getItem(TOOLS_KEY);
    return v === null ? memory : v === "1";
  } catch {
    return memory;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(TOOLS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(TOOLS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function NavLink({ item, pathname }: { item: Item; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      data-tour={item.tour}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/link relative flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[0.84rem] font-medium whitespace-nowrap text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground md:group-data-[rail=true]/sidebar:justify-center md:group-data-[rail=true]/sidebar:px-2",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary"
        />
      )}
      <Icon
        className="size-4 shrink-0 opacity-80 group-hover/link:opacity-100"
        aria-hidden="true"
      />
      <span className={RAIL_LABEL}>{item.label}</span>
    </Link>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "px-3 pb-1 text-[0.66rem] font-semibold tracking-wider text-muted-foreground uppercase",
        RAIL_HIDDEN,
      )}
    >
      {children}
    </p>
  );
}

export function Nav() {
  const pathname = usePathname();
  const inTools = TOOLS.some((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));
  // Open when the current page is one of the tools; otherwise the visitor's last choice, closed at first.
  const saved = useSyncExternalStore(subscribe, readSaved, () => null);
  const open = inTools || (saved ?? false);
  const toggle = () => {
    try {
      window.localStorage.setItem(TOOLS_KEY, open ? "0" : "1");
    } catch {
      // Storage may be blocked; fall back to a value kept for this page only.
      memory = !open;
    }
    window.dispatchEvent(new Event(TOOLS_EVENT));
  };
  return (
    <nav aria-label="Primary" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <GroupLabel>Main</GroupLabel>
        {MAIN.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="nav-tools"
          data-tour="nav-tools"
          onClick={toggle}
          className={cn(
            "flex items-center justify-between rounded-md px-3 pb-1 text-[0.66rem] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground",
            RAIL_HIDDEN,
          )}
        >
          Analysis tools
          <ChevronDown
            className={cn("size-3.5 transition-transform", open ? "" : "-rotate-90")}
            aria-hidden="true"
          />
        </button>
        <div
          id="nav-tools"
          className={cn(
            "flex-col gap-0.5",
            open ? "flex" : "hidden md:group-data-[rail=true]/sidebar:flex",
          )}
        >
          {TOOLS.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <GroupLabel>Help</GroupLabel>
        {HELP.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>
    </nav>
  );
}
