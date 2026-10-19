import { z } from "zod";

export const exposureSchema = z.object({
  magnitude: z.number().int().min(0).max(3),
  direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export type Exposure = z.infer<typeof exposureSchema>;

/** Signed exposure in [-3, 3]: effect on the company when the factor rises. */
export function signedExposure(e: Exposure): number {
  return e.magnitude * e.direction;
}
