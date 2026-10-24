import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import { writeModuleReport } from "./scripts/module-report.ts";

/**
 * Alias que solo existen al servir en desarrollo y en las pruebas: el manifiesto del banco para el
 * servidor simulado (T-31.2). El build de producción no los define, así que no puede resolverlos.
 */
export const devAliases = {
  "@dev/bank-manifest": fileURLToPath(new URL("../server/bank/manifest.json", import.meta.url)),
};

/** Escribe la lista de módulos de cada chunk del build para `check-dist` (T-31.2). */
function moduleReport(): Plugin {
  return {
    name: "sk-module-report",
    apply: "build",
    writeBundle(options, bundle) {
      writeModuleReport(options.dir ?? "dist", bundle);
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), moduleReport()],
  resolve: {
    // Los paquetes del monorepo se consumen desde sus fuentes TypeScript.
    conditions: ["@sudoku-killer/source", ...defaultClientConditions],
    alias: command === "serve" ? devAliases : {},
  },
  build: {
    // Nada se incrusta en base64: las fuentes van como archivos woff2 (entrega-f8.md §5).
    assetsInlineLimit: 0,
  },
}));
