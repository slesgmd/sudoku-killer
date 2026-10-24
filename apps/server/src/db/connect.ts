// Conexión a PostgreSQL con `pg` (producción y desarrollo) y migraciones de `drizzle/`. Las pruebas
// usan PGlite con el mismo esquema y las mismas migraciones.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import type { Database } from "./database.ts";
import * as schema from "./schema.ts";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface Connection {
  readonly db: Database;
  close(): Promise<void>;
}

export function connect(databaseUrl: string): Connection {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle({ client: pool, schema });
  return { db, close: () => pool.end() };
}

/** Aplica las migraciones pendientes (son idempotentes). */
export async function migrateDatabase(db: Database): Promise<void> {
  await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS });
}
