// Dónde está el servidor de salas (F12). En desarrollo y en las E2E, en el mismo origen que la página
// (`/ws`, que Vite reenvía). En producción, la web estática y el servidor viven en subdominios
// distintos (ADR 0007): el build recibe `VITE_SERVER_URL`, que solo puede ser `wss://` (TLS).
import { ACCESS_PATH } from "@sudoku-killer/protocol";

/** `ws(s)://<host>/ws` del mismo origen que la página. */
export function sameOriginUrl(location: {
  readonly protocol: string;
  readonly host: string;
}): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}

/**
 * El valor de `VITE_SERVER_URL`, si viene: un `wss://` con la ruta `/ws` y sin credenciales,
 * consulta ni fragmento. Cualquier otra cosa es un error de configuración del build.
 */
export function checkServerUrl(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("VITE_SERVER_URL no es una URL válida.");
  }
  if (url.protocol !== "wss:") throw new Error("VITE_SERVER_URL debe usar wss:// (TLS).");
  if (url.pathname !== "/ws" || url.search !== "" || url.hash !== "")
    throw new Error("VITE_SERVER_URL debe terminar en /ws, sin consulta ni fragmento.");
  if (url.username !== "" || url.password !== "")
    throw new Error("VITE_SERVER_URL no puede llevar credenciales.");
  return url.href;
}

/** La URL del WebSocket: la configurada en el build o, si no hay, la del mismo origen. */
export function serverUrl(
  configured: string | undefined,
  location: { readonly protocol: string; readonly host: string },
): string {
  return checkServerUrl(configured) ?? sameOriginUrl(location);
}

/**
 * Lo que la página pide al abrirse para que el servidor dormido empiece a despertar (F12g), o `null`
 * si el servidor está en el mismo origen (desarrollo y E2E). Es `GET /ws` (T-39.9), no `/healthz`:
 * la regla `||onrender.com/health` de EasyPrivacy, que Brave aplica a las peticiones a otro sitio,
 * bloquea `/healthz` (F12j). `/healthz` queda para el chequeo de Render y la prueba de humo.
 */
export function prewarmUrl(configured: string | undefined): string | null {
  const url = checkServerUrl(configured);
  return url === null ? null : probeUrl(url);
}

/** `POST /access` en el mismo servidor (T-39.12): `https://<host>/access` (o `http` sin TLS). */
export function accessUrl(wsUrl: string): string {
  return new URL(ACCESS_PATH, probeUrl(wsUrl)).href;
}

/** `GET /ws` por HTTP en el mismo servidor: `https://<host>/ws` (o `http` sin TLS). */
export function probeUrl(wsUrl: string): string {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.href;
}
