// Carga el banco de puzzles (ADR 0006) en la base de `DATABASE_URL` (apps/server/.env): aplica las
// migraciones y llama a `loadBank` con `bank/manifest.json`. Verifica cada semilla antes de escribir
// nada; con el banco completo tarda unos minutos. Las filas que ya no están en el manifiesto quedan
// retiradas, no se borran.
//
// Uso: pnpm --filter @sudoku-killer/server bank:load
import { readFileSync } from "node:fs";
import { manifestSchema } from "@sudoku-killer/bank";
import { ConfigError, loadConfig } from "../src/config/config.ts";
import { connect, migrateDatabase } from "../src/db/connect.ts";
import { redact } from "../src/log/logger.ts";
import { loadBank } from "../src/puzzles/load-bank.ts";
import { createPuzzleRepository } from "../src/puzzles/repository.ts";

try {
  const { databaseUrl } = loadConfig();
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(new URL("../bank/manifest.json", import.meta.url), "utf8")),
  );
  const connection = connect(databaseUrl);
  try {
    await migrateDatabase(connection.db);
    const total = manifest.entries.length;
    const result = await loadBank(connection.db, manifest, {
      onEntry: (_entry, index) => {
        if ((index + 1) % 100 === 0 || index + 1 === total) {
          process.stdout.write(`\r  verificadas ${String(index + 1)} de ${String(total)} semillas`);
        }
      },
    });
    process.stdout.write("\n");
    console.log(
      `✓ Banco cargado: ${String(result.inserted)} nuevos, ${String(result.existing)} ya estaban, ${String(result.reactivated)} reactivados y ${String(result.retired)} retirados.`,
    );
    console.log(
      `  Vigentes por dificultad: ${JSON.stringify(await createPuzzleRepository(connection.db).countByDifficulty())}`,
    );
  } finally {
    await connection.close();
  }
} catch (error) {
  console.error(
    error instanceof ConfigError
      ? error.message
      : `✗ No se pudo cargar el banco: ${String(redact(error instanceof Error ? error.message : "error"))}`,
  );
  process.exitCode = 1;
}
