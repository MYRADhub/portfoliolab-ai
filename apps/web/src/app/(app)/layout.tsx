import { Nav } from "@/components/layout/nav";
import { SessionBootstrap } from "@/components/layout/session-bootstrap";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r p-4">
        <div className="mb-6 text-lg font-semibold">PortfolioLab</div>
        <Nav />
      </aside>
      <main className="flex-1 p-8">{children}</main>
      <SessionBootstrap />
    </div>
  );
}
