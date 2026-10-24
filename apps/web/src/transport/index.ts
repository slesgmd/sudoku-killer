// Elección del transporte. En desarrollo, el servidor simulado en memoria (`src/dev/sim/`), que es el
// único lugar del navegador donde existe la solución. En producción no se incluye (T-31.2): la rama
// de `import.meta.env.DEV` desaparece del build, y con ella el `import()` del simulador.
import type { Transport } from "./types.ts";
import { createUnavailableTransport } from "./unavailable.ts";

export type { Transport, TransportStatus } from "./types.ts";

export async function createTransport(): Promise<Transport> {
  if (import.meta.env.DEV) {
    const { createDevTransport } = await import("../dev/sim/index.ts");
    return createDevTransport(new URLSearchParams(window.location.search));
  }
  // El servidor real llega en F10.
  return createUnavailableTransport();
}
