import { Suspense } from "react";
import { NotebookDeck } from "@/components/research/chat/notebook-deck";
import { Loading } from "@/components/ui/skeleton";

export default function Page() {
  return (
    <Suspense fallback={<Loading rows={3} />}>
      <NotebookDeck />
    </Suspense>
  );
}
