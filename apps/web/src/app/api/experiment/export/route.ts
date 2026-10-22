import { route } from "@/server/errors";
import { db } from "@/server/db";
import { assertAdmin, exportRows, toCsv } from "@/server/experiment";

export const GET = route(async (req) => {
  assertAdmin(req);
  return new Response(toCsv(await exportRows(db())), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="experiment.csv"',
    },
  });
});
