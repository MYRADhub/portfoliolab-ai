import { route } from "@/server/errors";
import { db } from "@/server/db";
import { experimentEnabled, requireParticipant } from "@/server/experiment";
import { AppError } from "@/server/errors";
import { MAX_HOLDINGS, MIN_HOLDINGS, MIN_WEIGHT_PCT } from "@/server/experiment";

export const GET = route(async () => {
  const limits = {
    minHoldings: MIN_HOLDINGS,
    maxHoldings: MAX_HOLDINGS,
    minWeightPct: MIN_WEIGHT_PCT,
  };
  if (!experimentEnabled()) return Response.json({ enabled: false });
  try {
    const p = await requireParticipant(db());
    return Response.json({
      enabled: true,
      limits,
      participant: { arm: p.arm, experience: p.experience, completed: p.completed },
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "unauthorized")
      return Response.json({ enabled: true, limits, participant: null });
    throw e;
  }
});
