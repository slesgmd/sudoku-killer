import { defineConfig } from "vitest/config";
import { CORPUS_TESTS, conditions } from "./vitest.config.ts";

// Solo los corpus (F4d): `pnpm test:corpus` y el workflow programado `corpus.yml`. Se arma aparte
// porque `mergeConfig` sumaría las listas `include` y `exclude` de la configuración base.
export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: [`packages/*/test/**/${CORPUS_TESTS}`],
    environment: "node",
    // El resumen de tiempos y descartes se imprime aunque la prueba pase.
    silent: false,
  },
});
