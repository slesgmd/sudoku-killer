// Servidor de salas: configuración desde el entorno, migraciones, comprobación del banco,
// reconstrucción de las partidas en curso y WebSocket en /ws. Apagado ordenado con SIGINT y SIGTERM.
// Con `--lan` (`pnpm dev:lan`), acepta también la web servida en las IP de la red local.
import { startApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config/config.ts";
import { connect, migrateDatabase } from "./db/connect.ts";
import { DestructiveMigrationError } from "./db/migration-guard.ts";
import { WS_PATH } from "./infra/ws-transport.ts";
import { createLogger } from "./log/logger.ts";
import { EmptyBankError } from "./puzzles/catalog.ts";

function configOrExit() {
  try {
    return loadConfig(process.env, { lan: process.argv.includes("--lan") });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const config = configOrExit();
const logger = createLogger({ level: config.logLevel });
const connection = connect(config.databaseUrl);

try {
  // En producción, una migración destructiva no se aplica sola (MIGRATIONS_ALLOW).
  const migrations = await migrateDatabase(connection.db, {
    guard: config.production,
    allow: config.migrationsAllow,
  });
  if (migrations.blocked.length > 0)
    logger.warn("destructive migrations applied outside production", {
      migrations: migrations.blocked,
    });
  const app = await startApp({ ...config, db: connection.db, logger });
  logger.info("room server listening", {
    host: config.host,
    port: app.port,
    path: WS_PATH,
    allowedOrigins: config.allowedOrigins,
    accessKeyRequired: config.accessKeyHash !== null,
    trustProxyHops: config.trustProxyHops,
    restoredMatches: app.restored,
    migrationsApplied: migrations.pending.length,
  });
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("shutting down", { signal });
    void app
      .stop()
      .then(() => connection.close())
      .then(() => process.exit(0));
  };
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
} catch (error) {
  if (error instanceof EmptyBankError) logger.error(error.message);
  else if (error instanceof DestructiveMigrationError)
    logger.error("destructive migrations blocked", { migrations: error.tags });
  else logger.error("server failed to start", { error });
  await connection.close();
  process.exit(1);
}
