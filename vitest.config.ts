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
    exclude: [...configDefaults.exclude, CORPUS_TESTS],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: [
            "packages/*/test/**/*.test.ts",
            "apps/*/test/**/*.test.ts",
            "tests/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        // Pruebas de componentes del cliente (nivel C de la SPEC): Testing Library sobre jsdom.
        extends: true,
        test: {
          name: "web",
          include: ["apps/web/test/**/*.test.tsx"],
          environment: "jsdom",
        },
      },
    ],
  },
});
