// `render.yaml` (F12, ADR 0007): sin secretos en el repositorio, despliegue desde `main` solo con
// los checks en verde, el servidor gratuito en Virginia con su chequeo de salud, y la web y el
// servidor apuntándose entre sí (origen permitido y `wss://`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { HEALTH_PATH } from "../apps/server/src/infra/ws-transport.ts";
import { securityHeaders } from "../apps/web/scripts/security-headers.ts";
import { checkServerUrl } from "../apps/web/src/transport/server-url.ts";

interface EnvVar {
  readonly key: string;
  readonly value?: string;
  readonly sync?: boolean;
}

interface Service {
  readonly type: string;
  readonly name: string;
  readonly runtime: string;
  readonly plan?: string;
  readonly region?: string;
  readonly branch?: string;
  readonly autoDeployTrigger?: string;
  readonly healthCheckPath?: string;
  readonly staticPublishPath?: string;
  readonly headers?: readonly {
    readonly path: string;
    readonly name: string;
    readonly value: string;
  }[];
  readonly envVars?: readonly EnvVar[];
}

export const render = parse(readFileSync(new URL("../render.yaml", import.meta.url), "utf8")) as {
  readonly services: readonly Service[];
};

export function service(runtime: string): Service {
  const found = render.services.find((s) => s.runtime === runtime);
  if (!found) throw new Error(`no ${runtime} service`);
  return found;
}

const env = (s: Service, key: string) => s.envVars?.find((v) => v.key === key);

/** Las variables que solo se escriben en el panel de Render. */
const SECRETS = ["DATABASE_URL", "ACCESS_KEY_HASH"];

describe("F12 render.yaml (ADR 0007)", () => {
  const server = service("node");
  const web = service("static");

  it("never carries a secret: those variables only exist with sync: false", () => {
    for (const s of render.services)
      for (const variable of s.envVars ?? [])
        if (SECRETS.includes(variable.key)) {
          expect(variable.value, variable.key).toBeUndefined();
          expect(variable.sync, variable.key).toBe(false);
        }
    for (const key of SECRETS) expect(env(server, key)?.sync, key).toBe(false);
  });

  it("deploys from main only after the commit checks pass", () => {
    for (const s of render.services) {
      expect(s.branch, s.name).toBe("main");
      expect(s.autoDeployTrigger, s.name).toBe("checksPass");
    }
  });

  it("runs the server on the free plan in Virginia, in production, with the health check", () => {
    expect(server.type).toBe("web");
    expect(server.plan).toBe("free");
    expect(server.region).toBe("virginia");
    expect(server.healthCheckPath).toBe(HEALTH_PATH);
    expect(env(server, "NODE_ENV")?.value).toBe("production");
    expect(env(server, "HOST")?.value).toBe("0.0.0.0");
  });

  it("S-05 serves the security headers of security-headers.ts on every path, with the server in connect-src", () => {
    const url = env(web, "VITE_SERVER_URL")?.value ?? null;
    expect(web.headers?.every((h) => h.path === "/*")).toBe(true);
    expect(web.headers?.map(({ name, value }) => ({ name, value }))).toEqual(securityHeaders(url));
    const csp = web.headers?.find((h) => h.name === "Content-Security-Policy")?.value ?? "";
    expect(csp).toContain(`wss://${server.name}.onrender.com`);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("points the web to the server over wss:// and allows only the web origin", () => {
    expect(web.staticPublishPath).toBe("apps/web/dist");
    const url = env(web, "VITE_SERVER_URL")?.value;
    expect(checkServerUrl(url)).toBe(`wss://${server.name}.onrender.com/ws`);
    expect(env(server, "ALLOWED_ORIGINS")?.value).toBe(`https://${web.name}.onrender.com`);
  });
});
