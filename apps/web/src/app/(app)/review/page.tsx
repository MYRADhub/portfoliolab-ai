import { ReviewView } from "@/components/review/review-view";
import { PageHeader } from "@/components/ui/page-header";

export default function Page() {
  return (
    <section>
      <PageHeader
        title="Exposure review"
        description="Check, correct and approve the hidden-exposure scores that AI drafted."
      />
      <ReviewView />
    </section>
  );
}
