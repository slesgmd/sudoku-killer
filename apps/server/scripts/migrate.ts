// Aplica las migraciones de `drizzle/` a la base de `DATABASE_URL` (apps/server/.env, o el secreto
// de `db-admin.yml`). Como el servidor en producción (F12f), una migración destructiva pendiente no
// se aplica salvo que esté en MIGRATIONS_ALLOW. Escribe solo recuentos (`db.migrations_*`), que los
// logs públicos de Actions dejan pasar (`scripts/ci/quiet.ts`), y nunca la cadena de conexión.
//
// Uso: pnpm --filter @sudoku-killer/server db:migrate
import { ConfigError, loadConfig } from "../src/config/config.ts";
import { connect, migrateDatabase } from "../src/db/connect.ts";
import { DestructiveMigrationError } from "../src/db/migration-guard.ts";

try {
  const { databaseUrl, migrationsAllow } = loadConfig();
  const connection = connect(databaseUrl);
  try {
    const plan = await migrateDatabase(connection.db, { guard: true, allow: migrationsAllow });
    console.log(`db.migrations_applied: ${String(plan.pending.length)}`);
    console.log("✓ Migraciones aplicadas.");
  } finally {
    await connection.close();
  }
} catch (error) {
  if (error instanceof DestructiveMigrationError) {
    console.log(`db.migrations_blocked: ${String(error.tags.length)}`);
    console.error(error.message);
  } else {
    console.error(
      error instanceof ConfigError
        ? error.message
        : `✗ No se pudieron aplicar las migraciones (${error instanceof Error ? error.name : "error"}).`,
    );
  }
  process.exitCode = 1;
}
