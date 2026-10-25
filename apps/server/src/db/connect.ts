// Conexión a PostgreSQL con `pg` (producción y desarrollo) y migraciones de `drizzle/`. Las pruebas
// usan PGlite con el mismo esquema y las mismas migraciones.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import type { Database } from "./database.ts";
import {
  DestructiveMigrationError,
  lastApplied,
  planMigrations,
  type MigrationPlan,
} from "./migration-guard.ts";
import * as schema from "./schema.ts";

export const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface Connection {
  readonly db: Database;
  close(): Promise<void>;
}

export function connect(databaseUrl: string): Connection {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle({ client: pool, schema });
  return { db, close: () => pool.end() };
}

export interface MigrateOptions {
  /** Con `true`, una migración destructiva pendiente que no está en `allow` no se aplica (F12f). */
  readonly guard?: boolean;
  /** Las migraciones destructivas permitidas (`MIGRATIONS_ALLOW`). */
  readonly allow?: readonly string[];
  readonly folder?: string;
}

/**
 * Aplica las migraciones pendientes (son idempotentes) y dice cuáles eran. Con `guard`, si alguna
 * destructiva no está permitida, no aplica ninguna y lanza `DestructiveMigrationError`.
 */
export async function migrateDatabase(
  db: Database,
  { guard = false, allow = [], folder = MIGRATIONS }: MigrateOptions = {},
): Promise<MigrationPlan> {
  const plan = planMigrations(folder, await lastApplied(db), allow);
  if (guard && plan.blocked.length > 0) throw new DestructiveMigrationError(plan.blocked);
  await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: folder });
  return plan;
}
