// Herramientas de PostgreSQL y de `age` para el respaldo y el simulacro (F12i). La salida de cada
// herramienta se descarta (nunca se imprime: podría traer la cadena de conexión o filas), y un fallo
// solo dice qué paso falló.
import { spawn } from "node:child_process";
import { join } from "node:path";
import pg from "pg";

/** Un paso que falló; el mensaje es solo el nombre del paso. */
export class StepError extends Error {
  constructor(step: string) {
    super(step);
    this.name = "StepError";
  }
}

/** La ruta de una herramienta: en `PG_BIN` si está definida (pg_dump, pg_restore), si no en el PATH. */
export function pgTool(name: string): string {
  const dir = process.env["PG_BIN"];
  return dir === undefined || dir === "" ? name : join(dir, name);
}

/** Corre una herramienta sin mostrar nada de su salida. */
export function run(step: string, file: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { stdio: ["ignore", "ignore", "ignore"] });
    child.on("error", () => {
      reject(new StepError(step));
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new StepError(step));
    });
  });
}

/** La misma URL con otra base de datos. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.href;
}

/** Crea de cero (borrándola si existía) una base vacía en el servidor de `adminUrl`. */
export async function freshDatabase(adminUrl: string, database: string): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new StepError("database_name");
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(`drop database if exists ${database}`);
    await client.query(`create database ${database}`);
  } catch {
    throw new StepError("restore_database");
  } finally {
    await client.end().catch(() => undefined);
  }
  return withDatabase(adminUrl, database);
}

export const RESTORE_DATABASE = "sk_restore_check";

/** `pg_restore` de un volcado en formato propio, sin dueños ni permisos del origen. */
export function restoreDump(dump: string, targetUrl: string): Promise<void> {
  return run("pg_restore", pgTool("pg_restore"), [
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    `--dbname=${targetUrl}`,
    dump,
  ]);
}
