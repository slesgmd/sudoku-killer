import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, loadEnv, type Plugin } from "vite";
import { writeModuleReport } from "./scripts/module-report.ts";
import { securityHeaders } from "./scripts/security-headers.ts";
import { checkServerUrl } from "./src/transport/server-url.ts";

/**
 * Alias que solo existen al servir en desarrollo y en las pruebas: el manifiesto del banco para el
 * servidor simulado (T-31.2). El build de producción no los define, así que no puede resolverlos.
 */
export const devAliases = {
  "@dev/bank-manifest": fileURLToPath(new URL("../server/bank/manifest.json", import.meta.url)),
};

/**
 * El WebSocket del juego (`/ws`) se reenvía al servidor de salas, que sigue escuchando solo en
 * 127.0.0.1 (F10). El `Origin` del navegador llega tal cual: el servidor lo compara con su lista de
 * orígenes permitidos (con `pnpm dev:lan`, también las IP de la red local). `SK_WS_TARGET` cambia el
 * destino (las pruebas E2E usan otro puerto).
 */
const wsProxy = {
  "/ws": { target: process.env["SK_WS_TARGET"] ?? "ws://127.0.0.1:8080", ws: true },
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

export default defineConfig(({ command, mode }) => {
  // F12: un `VITE_SERVER_URL` que no sea `wss://…/ws` detiene el build (TLS obligatorio).
  checkServerUrl(loadEnv(mode, process.cwd(), "VITE_")["VITE_SERVER_URL"]);
  return config(command);
});

function config(command: "build" | "serve") {
  return {
    plugins: [react(), moduleReport()],
    resolve: {
      // Los paquetes del monorepo se consumen desde sus fuentes TypeScript.
      conditions: ["@sudoku-killer/source", ...defaultClientConditions],
      alias: command === "serve" ? devAliases : {},
    },
    // Puerto fijo: el servidor solo acepta el origen de 5173 (y el de las IP locales con dev:lan).
    // Si está ocupado, Vite falla en lugar de pasar a otro puerto que el servidor rechazaría.
    server: { proxy: wsProxy, strictPort: true },
    // Las cabeceras del sitio publicado (S-05), con el servidor en el mismo origen: las E2E fallan
    // ante cualquier violación de la CSP.
    preview: {
      proxy: wsProxy,
      headers: Object.fromEntries(securityHeaders(null).map((h) => [h.name, h.value])),
    },
    build: {
      // Nada se incrusta en base64: las fuentes van como archivos woff2 (entrega-f8.md §5).
      assetsInlineLimit: 0,
    },
  };
}
