"use client";

import { useSearchParams } from "next/navigation";
import { DeckView } from "./deck-view";

export function NotebookDeck() {
  const portfolioId = useSearchParams().get("portfolioId");
  const query = portfolioId ? `?portfolioId=${encodeURIComponent(portfolioId)}` : "";
  return (
    <DeckView
      apiUrl={`/api/research/notebook/deck${query}`}
      source="notebook"
      links={[{ href: "/research/notebook", label: "Back to the notebook" }]}
    />
  );
}
