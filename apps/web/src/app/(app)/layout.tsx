import { Suspense } from "react";
import { Nav } from "@/components/layout/nav";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { ProgressTracker } from "@/components/onboarding/progress-tracker";
import { TourButton, TourProvider } from "@/components/onboarding/tour";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SessionBootstrap } from "@/components/layout/session-bootstrap";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TourProvider>
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col gap-3 border-b bg-sidebar p-3 text-sidebar-foreground md:sticky md:top-0 md:h-screen md:w-60 md:overflow-y-auto md:border-r md:border-b-0 md:p-4">
          <SidebarShell>
            <Suspense fallback={null}>
              <Nav />
            </Suspense>
            <div className="flex flex-col gap-1.5 md:mt-auto">
              <TourButton />
              <ThemeToggle />
            </div>
          </SidebarShell>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col p-4 md:h-screen md:overflow-hidden md:px-8 md:py-6">
          {DEMO_MODE && (
            <p
              role="note"
              className="mb-3 shrink-0 rounded-md border border-warn/60 bg-warn-soft px-3 py-2 text-sm"
            >
              Demo mode: prices, exposure profiles and news are made-up samples for exploring the
              app. Nothing here describes the real market.
            </p>
          )}
          {/* On desktop each page scrolls inside this area, so the window itself never scrolls and the Terminal can fill the screen. */}
          <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">{children}</div>
        </main>
        <SessionBootstrap />
        <Suspense fallback={null}>
          <ProgressTracker />
        </Suspense>
      </div>
    </TourProvider>
  );
}
