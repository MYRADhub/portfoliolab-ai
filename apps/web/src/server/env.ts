import { loadEnv, type Env } from "@portfolio-lab/shared";

let cached: Env | undefined;

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}
