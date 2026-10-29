// Administración de la base de producción desde Actions (`db-admin.yml`, a mano). Con
// DB_ADMIN_ACTION:
// - `status`: recuentos de las tablas y migraciones pendientes;
// - `migrate`: aplica las migraciones con la guarda de migraciones destructivas (MIGRATIONS_ALLOW para una destructiva);
// - `bank-load`: migra y carga el banco del manifiesto (ADR 0006; unos minutos).
// Solo escribe recuentos (`db.*`), nunca la cadena de conexión ni filas (docs/seguridad.md §3).
import { readFileSync } from "node:fs";
import { manifestSchema } from "@sudoku-killer/bank";
import { ConfigError, loadConfig } from "../src/config/config.ts";
import { MIGRATIONS, connect, migrateDatabase } from "../src/db/connect.ts";
import {
  DestructiveMigrationError,
  lastApplied,
  planMigrations,
} from "../src/db/migration-guard.ts";
import { loadBank } from "../src/puzzles/load-bank.ts";
import { printCounts, tableCounts } from "./db/restore-check.ts";

const ACTIONS = ["status", "migrate", "bank-load"] as const;
type Action = (typeof ACTIONS)[number];

function action(): Action {
  const value = process.env["DB_ADMIN_ACTION"] ?? "status";
  const found = ACTIONS.find((a) => a === value);
  if (found === undefined) throw new Error("action");
  return found;
}

async function main(): Promise<void> {
  const chosen = action();
  const { databaseUrl, migrationsAllow } = loadConfig();
  const connection = connect(databaseUrl);
  try {
    const { db } = connection;
    if (chosen !== "status") {
      const plan = await migrateDatabase(db, { guard: true, allow: migrationsAllow });
      console.log(`db.migrations_applied: ${String(plan.pending.length)}`);
    }
    if (chosen === "bank-load") {
      const manifest = manifestSchema.parse(
        JSON.parse(readFileSync(new URL("../bank/manifest.json", import.meta.url), "utf8")),
      );
      const result = await loadBank(db, manifest);
      console.log(`db.bank_inserted: ${String(result.inserted)}`);
      console.log(`db.bank_existing: ${String(result.existing)}`);
      console.log(`db.bank_reactivated: ${String(result.reactivated)}`);
      console.log(`db.bank_retired: ${String(result.retired)}`);
    }
    const pending = planMigrations(MIGRATIONS, await lastApplied(db), migrationsAllow);
    console.log(`db.migrations_pending: ${String(pending.pending.length)}`);
    console.log(`db.migrations_blocked: ${String(pending.blocked.length)}`);
    printCounts("db", await tableCounts(db));
    console.log(`db.${chosen.replace("-", "_")}: ok`);
  } finally {
    await connection.close();
  }
}

try {
  await main();
} catch (error) {
  const step =
    error instanceof DestructiveMigrationError
      ? "destructive_migration"
      : error instanceof ConfigError
        ? "config"
        : "unexpected";
  console.log(`db.step_${step}: fail`);
  process.exitCode = 1;
}
