"use client";

import { ChevronLeft, ChevronRight, CircleHelp, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { markVisited, updateOnboarding } from "@/lib/onboarding";
import { TOUR_STEPS } from "./steps";

interface TourApi {
  start: () => void;
  active: boolean;
}

const TourContext = createContext<TourApi>({ start: () => undefined, active: false });
export const useTour = () => useContext(TourContext);

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const POPOVER_WIDTH = 360;

function findTarget(name: string | undefined): HTMLElement | null {
  return name ? document.querySelector<HTMLElement>(`[data-tour="${name}"]`) : null;
}

/** Provides the guided tour and renders it on top of the page while it is running. */
export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pathname, setPathname] = useState("");
  const [index, setIndex] = useState<number | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const active = index !== null;

  const start = useCallback(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
  }, []);

  const close = useCallback((finished: boolean) => {
    setIndex(null);
    updateOnboarding({ tourDone: true });
    if (finished) markVisited("tour");
    returnFocus.current?.focus();
  }, []);

  // Move to the page a step belongs to.
  const step = index === null ? null : TOUR_STEPS[index]!;
  useEffect(() => {
    if (step && pathname && pathname !== step.href) router.push(step.href);
  }, [step, pathname, router]);

  return (
    <TourContext.Provider value={{ start, active }}>
      <Suspense fallback={null}>
        <PathReporter onPath={setPathname} />
      </Suspense>
      {children}
      {step && index !== null && (
        <TourOverlay
          key={step.id}
          stepIndex={index}
          onlyWhenOnPage={pathname === step.href}
          onNext={() => (index === TOUR_STEPS.length - 1 ? close(true) : setIndex(index + 1))}
          onBack={() => setIndex(Math.max(0, index - 1))}
          onClose={() => close(false)}
        />
      )}
    </TourContext.Provider>
  );
}

/** Reports the current path. Kept in its own Suspense boundary so reading the URL never delays the page. */
function PathReporter({ onPath }: { onPath: (p: string) => void }) {
  const pathname = usePathname();
  useEffect(() => onPath(pathname), [pathname, onPath]);
  return null;
}

function TourOverlay({
  stepIndex,
  onlyWhenOnPage,
  onNext,
  onBack,
  onClose,
}: {
  stepIndex: number;
  onlyWhenOnPage: boolean;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const step = TOUR_STEPS[stepIndex]!;
  const last = stepIndex === TOUR_STEPS.length - 1;
  const [box, setBox] = useState<Box | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Find the target once its page has rendered (it may still be loading data), then keep the spotlight on it.
  useEffect(() => {
    if (!onlyWhenOnPage) return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    let scrolled = false;

    const measure = () => {
      if (cancelled) return;
      const el = findTarget(step.target);
      if (el) {
        if (!scrolled) {
          el.scrollIntoView({ block: "center", behavior: "auto" });
          scrolled = true;
        }
        const r = el.getBoundingClientRect();
        setBox((prev) =>
          prev &&
          prev.top === r.top &&
          prev.left === r.left &&
          prev.width === r.width &&
          prev.height === r.height
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
      } else if (step.target && attempts++ > 60) {
        setBox(null); // never appeared: show the step centered instead of getting stuck
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [onlyWhenOnPage, step.target]);

  useLayoutEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft" && stepIndex > 0) onBack();
      else if (e.key === "Tab") {
        // Keep focus inside the dialog.
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button, [href], [tabindex]:not([tabindex='-1'])",
        );
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0]!;
        const lastNode = nodes[nodes.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastNode.focus();
        } else if (!e.shiftKey && document.activeElement === lastNode) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onBack, onClose, stepIndex]);

  const spot = box && step.target ? box : null;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const narrow = vw < 768;
  let popoverStyle: React.CSSProperties;
  if (!spot || narrow) {
    popoverStyle = narrow
      ? { left: 12, right: 12, bottom: 12 }
      : { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: POPOVER_WIDTH };
  } else {
    const below = spot.top + spot.height + PAD + 12;
    const fitsBelow = below + 220 < vh;
    const left = Math.min(Math.max(12, spot.left), vw - POPOVER_WIDTH - 12);
    popoverStyle = fitsBelow
      ? { left, top: below, width: POPOVER_WIDTH }
      : { left, bottom: Math.max(12, vh - spot.top + PAD + 12), width: POPOVER_WIDTH };
  }

  return (
    <div className="fixed inset-0 z-50" data-testid="tour">
      {/* Click catcher: the page behind is not interactive while the tour runs. */}
      <div className="absolute inset-0" aria-hidden="true" />
      {spot ? (
        <div
          aria-hidden="true"
          data-tour-spotlight=""
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary"
          style={{
            top: spot.top - PAD,
            left: spot.left - PAD,
            width: spot.width + PAD * 2,
            height: spot.height + PAD * 2,
            boxShadow: "0 0 0 9999px color-mix(in oklch, black 55%, transparent)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/55" />
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="absolute rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none"
        style={popoverStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="tour-title" className="text-base font-semibold">
            {step.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Skip tour"
            className="-mt-1 -mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p id="tour-body" className="mt-2 text-sm text-muted-foreground">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Step {stepIndex + 1} of {TOUR_STEPS.length}
          </p>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <Button variant="outline" size="sm" onClick={onBack}>
                <ChevronLeft aria-hidden="true" />
                Back
              </Button>
            )}
            <Button size="sm" onClick={onNext}>
              {last ? "Finish" : "Next"}
              {!last && <ChevronRight aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sidebar button that starts (or replays) the tour. */
export function TourButton() {
  const { start } = useTour();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={start}
      className="w-full justify-start"
      data-tour="tour-button"
    >
      <CircleHelp aria-hidden="true" />
      Take the tour
    </Button>
  );
}
