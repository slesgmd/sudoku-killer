import { defaultServerConditions } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
import { devAliases } from "./apps/web/vite.config.ts";

export const conditions = ["@sudoku-killer/source", ...defaultServerConditions];

/** Pruebas largas que no corren en cada push: `pnpm test:corpus` (vitest.corpus.config.ts). */
export const CORPUS_TESTS = "**/*.corpus.test.ts";

export default defineConfig({
  // El alias del manifiesto para el servidor simulado del cliente (solo desarrollo y pruebas).
  resolve: { conditions, alias: devAliases },
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
