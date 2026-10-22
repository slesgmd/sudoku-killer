import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

const conditions = ["@sudoku-killer/source", ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.{ts,tsx}",
      "tests/**/*.test.ts",
    ],
    environment: "node",
  },
});
