import { defaultServerConditions } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

export const conditions = ["@sudoku-killer/source", ...defaultServerConditions];

/** Pruebas largas que no corren en cada push: `pnpm test:corpus` (vitest.corpus.config.ts). */
export const CORPUS_TESTS = "**/*.corpus.test.ts";

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.{ts,tsx}",
      "tests/**/*.test.ts",
    ],
    exclude: [...configDefaults.exclude, CORPUS_TESTS],
    environment: "node",
  },
});
