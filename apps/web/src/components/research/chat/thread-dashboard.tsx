"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Loading } from "@/components/ui/skeleton";
import { useApi } from "@/lib/use-api";
import type { ChatMessage, ThreadSummary } from "@/server/research-chat";
import { AnswerDashboard } from "./visualize";

interface ThreadData {
  thread: ThreadSummary;
  messages: ChatMessage[];
  disclaimer: string;
}

/** Every chart, table and key figure from one conversation, one section per question. */
export function ThreadDashboard({ threadId }: { threadId: string }) {
  const { data, error } = useApi<ThreadData>(`/api/research/threads/${threadId}`);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <Loading rows={3} />;

  const sections: { question: string; answer: Extract<ChatMessage, { role: "assistant" }> }[] = [];
  data.messages.forEach((m, i) => {
    const q = data.messages[i - 1];
    if (m.role === "assistant" && q?.role === "user")
      sections.push({ question: q.content, answer: m });
  });

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href={`/research?thread=${threadId}`}
          className="text-muted-foreground hover:underline"
        >
          Back to the conversation
        </Link>
        <Link
          href={`/research/c/${threadId}/deck`}
          className="text-muted-foreground hover:underline"
        >
          Presentation
        </Link>
      </div>
      <PageHeader
        title={data.thread.title}
        description="Every chart, table and key figure the research assistant gathered in this conversation."
      />
      {sections.length === 0 && (
        <p className="text-sm text-muted-foreground">This conversation has no answers yet.</p>
      )}
      {sections.map((s, i) => (
        <section
          key={s.answer.id}
          aria-labelledby={`q-${s.answer.id}`}
          className="space-y-3 rounded-xl border p-4"
        >
          <h2 id={`q-${s.answer.id}`} className="font-medium">
            <span className="mr-2 text-muted-foreground">{i + 1}.</span>
            {s.question}
          </h2>
          {s.answer.answer.source === "fallback" && (
            <p className="text-xs text-muted-foreground">
              The written answer to this question could not be verified; the figures below are.
            </p>
          )}
          <AnswerDashboard
            facts={s.answer.answer.facts}
            displays={s.answer.answer.allDisplays ?? s.answer.answer.displays}
          />
        </section>
      ))}
      <p className="text-xs text-muted-foreground">{data.disclaimer}</p>
    </section>
  );
}
