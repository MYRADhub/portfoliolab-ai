"use client";

import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTour } from "./tour";

/** A button for content pages that replays the guided tour. */
export function TourLauncher() {
  const { start } = useTour();
  return (
    <Button onClick={start}>
      <Rocket aria-hidden="true" />
      Start the guided tour
    </Button>
  );
}
