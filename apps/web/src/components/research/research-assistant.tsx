"use client";

import { WithPortfolio } from "@/components/portfolio/with-portfolio";
import { AssistantPanel } from "./assistant-panel";

export function ResearchAssistant() {
  return <WithPortfolio>{(id) => <AssistantPanel portfolioId={id} />}</WithPortfolio>;
}
