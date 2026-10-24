// Base de datos de prueba: PGlite en memoria con las migraciones de `drizzle/` (ADR 0001).
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "../../src/db/database.ts";
import * as schema from "../../src/db/schema.ts";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function createTestDatabase(): Promise<{ db: Database; client: PGlite }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, client };
}
