// Configuración del servidor, solo desde variables de entorno (validadas con Zod). En desarrollo se
// cargan desde `apps/server/.env` (no se versiona; la forma está en `apps/server/.env.example`). Un
// error de configuración dice qué variable falta o no vale, nunca su valor.
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { z } from "zod";
import { normalizeOrigin } from "../infra/ws-transport.ts";
import type { LogLevel } from "../log/logger.ts";

export const ENV_FILE = "apps/server/.env";

export interface Config {
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly logLevel: LogLevel;
  /** `NODE_ENV=production`: la clave de acceso es obligatoria (F12, S-02). */
  readonly production: boolean;
  /** El hash de la clave de acceso del grupo (`sha256:…`), o `null` sin clave (solo en desarrollo). */
  readonly accessKeyHash: string | null;
  /** Proxies de confianza delante del servidor, para la IP del cliente (F12, S-01). */
  readonly trustProxyHops: number;
}

/** La forma de `ACCESS_KEY_HASH` (la escribe `pnpm --filter @sudoku-killer/server access:key`). */
export const ACCESS_KEY_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** El puerto de Vite en desarrollo. */
export const DEV_WEB_PORT = 5173;

/** El origen de `pnpm dev` (Vite en localhost). */
export const DEV_ORIGIN = `http://localhost:${String(DEV_WEB_PORT)}`;

/** 10/8, 172.16/12 y 192.168/16 (RFC 1918): las direcciones de una red local. */
export function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a = -1, b = -1] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Los orígenes de `pnpm dev:lan`: la web de Vite en cada IPv4 privada de esta máquina. Solo para
 * desarrollo en la red de casa; en producción los orígenes salen de `ALLOWED_ORIGINS`.
 */
export function lanOrigins(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
  port = DEV_WEB_PORT,
): string[] {
  const origins = new Set<string>();
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      if (info.family === "IPv4" && !info.internal && isPrivateIPv4(info.address)) {
        origins.add(`http://${info.address}:${String(port)}`);
      }
    }
  }
  return [...origins];
}

const originList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map(normalizeOrigin)
      .filter((o) => o !== ""),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1));

const schema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\/.+/),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(8080),
  ALLOWED_ORIGINS: originList.default([DEV_ORIGIN]),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.string().optional(),
  ACCESS_KEY_HASH: z.string().regex(ACCESS_KEY_HASH_PATTERN).optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
});

export interface LoadConfigOptions {
  /** `pnpm dev:lan`: suma los orígenes de la red local (solo fuera de producción). */
  readonly lan?: boolean;
  readonly interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Lee la configuración. Lanza `ConfigError` con los nombres de las variables que fallan. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  { lan = false, interfaces }: LoadConfigOptions = {},
): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const name = String(issue.path[0] ?? "?");
      return env[name] === undefined || env[name] === "" ? `falta ${name}` : `${name} no es válida`;
    });
    throw new ConfigError(
      `Configuración inválida: ${[...new Set(problems)].join(", ")}. Defínelas en ${ENV_FILE} (ver apps/server/.env.example) o en el entorno.`,
    );
  }
  const {
    DATABASE_URL,
    HOST,
    PORT,
    ALLOWED_ORIGINS,
    LOG_LEVEL,
    NODE_ENV,
    ACCESS_KEY_HASH,
    TRUST_PROXY_HOPS,
  } = parsed.data;
  const production = NODE_ENV === "production";
  if (lan && production) {
    throw new ConfigError(
      "Configuración inválida: --lan (pnpm dev:lan) es solo para desarrollo en la red de casa, no para producción.",
    );
  }
  if (production && ACCESS_KEY_HASH === undefined) {
    throw new ConfigError(
      "Configuración inválida: falta ACCESS_KEY_HASH, obligatoria en producción (la clave de acceso del grupo, docs/seguridad.md S-02).",
    );
  }
  return {
    databaseUrl: DATABASE_URL,
    host: HOST,
    port: PORT,
    allowedOrigins: lan
      ? [...new Set([...ALLOWED_ORIGINS, ...lanOrigins(interfaces)])]
      : ALLOWED_ORIGINS,
    logLevel: LOG_LEVEL,
    production,
    accessKeyHash: ACCESS_KEY_HASH ?? null,
    trustProxyHops: TRUST_PROXY_HOPS,
  };
}
