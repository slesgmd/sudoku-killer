// Cabeceras de seguridad del sitio estático (F12, `docs/seguridad.md` S-05): una sola fuente para
// `render.yaml` (lo comprueba tests/render-config.test.ts), `vite preview` en las E2E (que fallan
// ante cualquier violación de la CSP) y la prueba de humo del despliegue. La CSP solo permite lo del
// propio sitio y, para conectarse, el servidor de salas: un XSS no podría enviar la ficha ni la
// clave a otro lado.

export interface SecurityHeader {
  readonly name: string;
  readonly value: string;
}

/** `wss://host/ws` → los orígenes del WebSocket y de su `/healthz`. */
function serverOrigins(serverUrl: string): string[] {
  const url = new URL(serverUrl);
  return [`wss://${url.host}`, `https://${url.host}`];
}

/** La CSP del sitio. Sin `serverUrl`, el servidor está en el mismo origen (desarrollo y E2E). */
export function contentSecurityPolicy(serverUrl: string | null): string {
  const connect = ["'self'", ...(serverUrl === null ? [] : serverOrigins(serverUrl))];
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Todas las cabeceras del sitio, en el orden de `render.yaml`. */
export function securityHeaders(serverUrl: string | null): SecurityHeader[] {
  return [
    { name: "Content-Security-Policy", value: contentSecurityPolicy(serverUrl) },
    { name: "Strict-Transport-Security", value: "max-age=31536000" },
    { name: "X-Content-Type-Options", value: "nosniff" },
    { name: "X-Frame-Options", value: "DENY" },
    { name: "Referrer-Policy", value: "no-referrer" },
    { name: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { name: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}
