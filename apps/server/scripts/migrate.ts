// Aplica las migraciones de `drizzle/` a la base de `DATABASE_URL` (apps/server/.env).
//
// Uso: pnpm --filter @sudoku-killer/server db:migrate
import { ConfigError, loadConfig } from "../src/config/config.ts";
import { connect, migrateDatabase } from "../src/db/connect.ts";

try {
  const { databaseUrl } = loadConfig();
  const connection = connect(databaseUrl);
  try {
    await migrateDatabase(connection.db);
    console.log("✓ Migraciones aplicadas.");
  } finally {
    await connection.close();
  }
} catch (error) {
  console.error(
    error instanceof ConfigError
      ? error.message
      : `✗ No se pudieron aplicar las migraciones (${error instanceof Error ? error.name : "error"}).`,
  );
  process.exitCode = 1;
}
