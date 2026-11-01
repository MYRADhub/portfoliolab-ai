import { Suspense } from "react";
import { DeckView } from "@/components/research/chat/deck-view";
import { Loading } from "@/components/ui/skeleton";

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeckView threadId={id} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading rows={3} />}>
      <View params={params} />
    </Suspense>
  );
}
