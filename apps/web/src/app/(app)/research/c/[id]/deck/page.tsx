import { Suspense } from "react";
import { DeckView } from "@/components/research/chat/deck-view";
import { Loading } from "@/components/ui/skeleton";

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <DeckView
      apiUrl={`/api/research/threads/${id}/deck`}
      source="conversation"
      links={[
        { href: `/research?thread=${id}`, label: "Back to the conversation" },
        { href: `/research/c/${id}/dashboard`, label: "Dashboard" },
      ]}
    />
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading rows={3} />}>
      <View params={params} />
    </Suspense>
  );
}
