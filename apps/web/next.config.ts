import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { fileURLToPath } from "node:url";

// Single .env at the monorepo root.
loadEnvConfig(fileURLToPath(new URL("../..", import.meta.url)));

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@portfolio-lab/shared", "@portfolio-lab/db"],
  serverExternalPackages: ["postgres", "pino"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
