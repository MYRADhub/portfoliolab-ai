import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Browser tests under e2e/ are run by Playwright, not Vitest.
  test: { environment: "node", exclude: ["e2e/**", "e2e-real/**", ".next/**", "node_modules/**"] },
});
