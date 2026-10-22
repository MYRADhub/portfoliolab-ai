import { route } from "@/server/errors";
import { db } from "@/server/db";
import {
  assertEnabled,
  computeMetrics,
  getUniverse,
  logEvent,
  requireParticipant,
  selectionSchema,
  validateSelection,
  viewFor,
} from "@/server/experiment";

export const POST = route(async (req) => {
  assertEnabled();
  const p = await requireParticipant(db());
  const { holdings } = selectionSchema.parse(await req.json());
  const universe = new Set((await getUniverse(db(), "control")).map((c) => c.ticker));
  validateSelection(holdings, universe);
  const metrics = await computeMetrics(db(), holdings);
  await logEvent(db(), p.id, "previewed", { n: holdings.length });
  return Response.json({ arm: p.arm, ...viewFor(p.arm, metrics) });
});
