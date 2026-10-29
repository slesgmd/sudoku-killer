// Prueba de humo del despliegue: se corre desde Actions (`smoke.yml`) contra la web y el
// servidor publicados. Solo imprime `smoke.<prueba>: ok|fail` (docs/seguridad.md §3); nunca el
// contenido de una respuesta. Variables: SMOKE_WEB_URL (https://…) y SMOKE_SERVER_URL (wss://…/ws).
import { randomBytes } from "node:crypto";
import { ACCESS_KEY_HEADER, ACCESS_PATH, encodeAccessKey } from "@sudoku-killer/protocol";
import WebSocket from "ws";
import { securityHeaders, type SecurityHeader } from "../../web/scripts/security-headers.ts";
import { isMain } from "./is-main.ts";

const WAKE_MS = 120_000;

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`falta ${name}`);
  return value;
}

/**
 * Abre un WebSocket y dice cómo terminó: abierto, rechazado con un estado HTTP o cerrado. Al abrir
 * envía un `sys.ping`, como el navegador, que envía algo en cuanto abre.
 */
export function tryWebSocket(
  url: string,
  origin: string,
  protocols: readonly string[] = [],
): Promise<{ readonly opened: boolean; readonly status?: number; readonly closeCode?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, [...protocols], { origin, handshakeTimeout: 15_000 });
    let opened = false;
    ws.on("open", () => {
      opened = true;
      ws.send(JSON.stringify({ v: 1, id: "smoke-1", type: "sys.ping", payload: { t0: 0 } }));
      // Se espera un momento: un rechazo de acceso llega como cierre justo después.
      setTimeout(() => {
        ws.close(1000);
      }, 1_000);
    });
    ws.on("unexpected-response", (_request, response) => {
      resolve({ opened: false, status: response.statusCode ?? 0 });
      ws.terminate();
    });
    ws.on("close", (code) => {
      resolve({ opened, closeCode: code });
    });
    ws.on("error", () => {
      resolve({ opened: false });
    });
  });
}

/**
 * El camino real de la clave (T-39.17): `POST /access` sin clave y con una inválida, generada al azar
 * en cada corrida (nunca la real), tienen que dar 401, con CORS para el origen de la web; desde un
 * origen ajeno, 403. Con el 4003 no se puede contar: el proxy de Render lo pierde (T-39.16).
 */
export async function checkAccess(serverUrl: string, origin: string): Promise<[string, boolean][]> {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = ACCESS_PATH;
  const post = async (from: string, key: string | null) => {
    const encoded = key === null ? null : encodeAccessKey(key);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { origin: from, ...(encoded === null ? {} : { [ACCESS_KEY_HEADER]: encoded }) },
        signal: AbortSignal.timeout(30_000),
      });
      return { status: response.status, cors: response.headers.get("access-control-allow-origin") };
    } catch {
      return { status: 0, cors: null };
    }
  };
  const keyless = await post(origin, null);
  const wrong = await post(origin, randomBytes(16).toString("hex"));
  const foreign = await post("https://otro-sitio.example", null);
  return [
    ["access_keyless_401", keyless.status === 401 && keyless.cors === origin],
    ["access_wrong_key_401", wrong.status === 401 && wrong.cors === origin],
    ["access_foreign_origin_403", foreign.status === 403 && foreign.cors === null],
  ];
}

/** El `max-age` de una cabecera `Strict-Transport-Security`, o `null` si no lo tiene. */
function hstsMaxAge(value: string): number | null {
  const match = /(?:^|;)\s*max-age=(\d+)\s*(?:;|$)/i.exec(value);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * Si cada cabecera de seguridad llegó como se espera: igual, salvo `Strict-Transport-Security`, que
 * puede ser más estricta. En `onrender.com`, Render la reemplaza por la suya (diez años, con
 * `includeSubDomains` y `preload`, el dominio está en la lista de precarga de los navegadores).
 */
export function checkSecurityHeaders(
  expected: readonly SecurityHeader[],
  actual: { get(name: string): string | null },
): [string, boolean][] {
  return expected.map(({ name, value }) => {
    const got = actual.get(name);
    if (name.toLowerCase() !== "strict-transport-security") return [name, got === value];
    const want = hstsMaxAge(value);
    const have = got === null ? null : hstsMaxAge(got);
    return [name, want !== null && have !== null && have >= want];
  });
}

/** `Content-Security-Policy` → `content_security_policy` (el nombre de la línea del log). */
const lineName = (header: string) => header.toLowerCase().replace(/-/g, "_");

async function waitForHealth(url: string): Promise<boolean> {
  const deadline = Date.now() + WAKE_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (response.status === 204) return true;
    } catch {
      // Despertando: se reintenta.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return false;
}

export async function smoke(): Promise<boolean> {
  const web = new URL(env("SMOKE_WEB_URL"));
  const server = new URL(env("SMOKE_SERVER_URL"));
  const origin = web.origin;
  const results: [string, boolean][] = [];
  const record = (name: string, ok: boolean) => {
    results.push([name, ok]);
    console.log(`smoke.${name}: ${ok ? "ok" : "fail"}`);
  };

  record("server_wss", server.protocol === "wss:");
  record("web_https", web.protocol === "https:");
  const health = new URL("/healthz", `https://${server.host}`).href;
  record("healthz", await waitForHealth(health));

  const page = await fetch(web.href, { redirect: "manual" });
  record("web_status", page.status === 200);
  const headers = checkSecurityHeaders(securityHeaders(server.href), page.headers);
  for (const [name, ok] of headers) record(`web_header_${lineName(name)}`, ok);
  record(
    "web_security_headers",
    headers.every(([, ok]) => ok),
  );

  const plain = new URL(web.href);
  plain.protocol = "http:";
  const redirect = await fetch(plain.href, { redirect: "manual" });
  const location = redirect.headers.get("location") ?? "";
  record(
    "web_http_redirects",
    redirect.status >= 301 && redirect.status <= 308 && location.startsWith("https://"),
  );

  const foreign = await tryWebSocket(server.href, "https://otro-sitio.example");
  record("ws_foreign_origin_403", foreign.status === 403);
  const allowed = await tryWebSocket(server.href, origin);
  record("ws_allowed_origin_opens", allowed.opened);
  // Sin clave, el navegador muestra «Clave del grupo» por el 401 de `POST /access` (T-39.17). Si el
  // servidor no pide clave, responde 204 y la prueba lo dice.
  for (const [name, ok] of await checkAccess(server.href, origin)) record(name, ok);

  return results.every(([, ok]) => ok);
}

if (isMain(import.meta.url, process.argv[1])) {
  try {
    process.exitCode = (await smoke()) ? 0 : 1;
  } catch {
    console.log("smoke.config: fail");
    process.exitCode = 1;
  }
}
