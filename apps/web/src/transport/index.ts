// Elección del transporte. Por defecto, el servidor real por WebSocket: en producción, el de
// `VITE_SERVER_URL` (F12, solo `wss://`); sin ella, el del mismo origen (`/ws`; en desarrollo, Vite lo
// reenvía al servidor local). Solo en desarrollo, con `?sim=1`, el servidor
// simulado en memoria (`src/dev/sim/`), que es el único lugar del navegador donde existe la
// solución. En producción no se incluye (T-31.2): la rama de `import.meta.env.DEV` desaparece del
// build, y con ella el `import()` del simulador.
import { accessProtocols } from "@sudoku-killer/protocol";
import { browserSession } from "../game/session.ts";
import type { Transport } from "./types.ts";
import { serverUrl } from "./server-url.ts";
import { createWsTransport } from "./ws.ts";

export type { Transport, TransportStatus } from "./types.ts";

export function createServerTransport(): Transport {
  return createWsTransport({
    url: serverUrl(import.meta.env.VITE_SERVER_URL, window.location),
    // La clave del grupo (R-39) se lee en cada intento: una recién escrita vale en el siguiente.
    protocols: () => accessProtocols(browserSession.accessKey()),
    ...(import.meta.env.DEV
      ? {
          debug: (message: string) => {
            console.debug(message);
          },
        }
      : {}),
  });
}

export async function createTransport(): Promise<Transport> {
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sim") === "1") {
      const { createDevTransport } = await import("../dev/sim/index.ts");
      return createDevTransport(params);
    }
  }
  return createServerTransport();
}
