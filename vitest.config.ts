import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.tsx",
      "adapters/*/**/*.test.ts",
      "scripts/**/*.test.ts", "docker/*/runner/src/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "spike/**", "data/**"],
  },
});
