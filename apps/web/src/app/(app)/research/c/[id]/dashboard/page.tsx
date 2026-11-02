import { Suspense } from "react";
import { ThreadDashboard } from "@/components/research/chat/thread-dashboard";
import { Loading } from "@/components/ui/skeleton";

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ThreadDashboard threadId={id} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading rows={3} />}>
      <View params={params} />
    </Suspense>
  );
}
