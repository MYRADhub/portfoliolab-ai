"use client";

import {
  Activity,
  BookOpen,
  Compass,
  Gauge,
  FileText,
  GitCompare,
  Grid3x3,
  LayoutDashboard,
  Network,
  Newspaper,
  Scale,
  Search,
  SquareTerminal,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Marks the element for the guided tour. */
  tour: string;
}

const groups: { label: string; items: Item[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tour: "nav-dashboard" },
      { href: "/terminal", label: "Terminal", icon: SquareTerminal, tour: "nav-terminal" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { href: "/exposures", label: "Exposures", icon: Network, tour: "nav-exposures" },
      { href: "/correlation", label: "Correlation", icon: Grid3x3, tour: "nav-correlation" },
      { href: "/forces", label: "What the forces did", icon: Activity, tour: "nav-forces" },
      { href: "/benchmark", label: "Market comparison", icon: Gauge, tour: "nav-benchmark" },
      { href: "/compare", label: "Compare", icon: GitCompare, tour: "nav-compare" },
      { href: "/stress", label: "Stress Lab", icon: Zap, tour: "nav-stress" },
      { href: "/discovery", label: "Discovery", icon: Compass, tour: "nav-discovery" },
      { href: "/rebalance", label: "Rebalance Lab", icon: Scale, tour: "nav-rebalance" },
      { href: "/simulation", label: "Simulation", icon: TrendingUp, tour: "nav-simulation" },
    ],
  },
  {
    label: "Market",
    items: [
      { href: "/news", label: "News", icon: Newspaper, tour: "nav-news" },
      { href: "/events", label: "Reactions", icon: Activity, tour: "nav-events" },
      { href: "/research", label: "Research", icon: Search, tour: "nav-research" },
    ],
  },
  {
    label: "Help",
    items: [
      { href: "/report", label: "Report", icon: FileText, tour: "nav-report" },
      { href: "/guide", label: "Guide", icon: BookOpen, tour: "nav-guide" },
    ],
  },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-[0.68rem] font-semibold tracking-wider text-muted-foreground uppercase">
            {g.label}
          </p>
          {g.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-tour={item.tour}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
