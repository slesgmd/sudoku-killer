// Configuración del servidor, solo desde variables de entorno (validadas con Zod). En desarrollo se
// cargan desde `apps/server/.env` (no se versiona; la forma está en `apps/server/.env.example`). Un
// error de configuración dice qué variable falta o no vale, nunca su valor.
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
}

/** El origen de `pnpm dev` (Vite en localhost). */
export const DEV_ORIGIN = "http://localhost:5173";

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
});

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Lee la configuración. Lanza `ConfigError` con los nombres de las variables que fallan. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
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
  const { DATABASE_URL, HOST, PORT, ALLOWED_ORIGINS, LOG_LEVEL } = parsed.data;
  return {
    databaseUrl: DATABASE_URL,
    host: HOST,
    port: PORT,
    allowedOrigins: ALLOWED_ORIGINS,
    logLevel: LOG_LEVEL,
  };
}
