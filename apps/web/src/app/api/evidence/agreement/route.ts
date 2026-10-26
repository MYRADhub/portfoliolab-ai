import { route } from "@/server/errors";
import { db } from "@/server/db";
import { agreementCsv, getDraftAgreement } from "@/server/agreement";

/** Every blind human score next to the AI draft it was compared with, one row per company and force. */
export const GET = route(async () => {
  const a = await getDraftAgreement(db(), { resamples: 0 });
  return new Response(agreementCsv(a), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="ai-vs-human-exposures.csv"',
    },
  });
});
