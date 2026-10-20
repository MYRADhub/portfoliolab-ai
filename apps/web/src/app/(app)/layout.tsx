import { Nav } from "@/components/layout/nav";
import { SessionBootstrap } from "@/components/layout/session-bootstrap";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="shrink-0 border-b p-3 md:w-56 md:border-r md:border-b-0 md:p-4">
        <div className="mb-3 text-lg font-semibold md:mb-6">PortfolioLab</div>
        <Nav />
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      <SessionBootstrap />
    </div>
  );
}
