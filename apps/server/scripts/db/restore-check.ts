// Comprobación de una base restaurada (F12i): los recuentos de cada tabla y el arranque real del
// servidor sobre ella (migraciones con la guarda, banco de cada dificultad y reconstrucción de las
// partidas en curso, ADR 0003). Lo usan el respaldo semanal y el simulacro de restauración.
import { count, isNull } from "drizzle-orm";
import { startApp } from "../../src/app.ts";
import { migrateDatabase } from "../../src/db/connect.ts";
import type { Database } from "../../src/db/database.ts";
import { matchEvents, matches, puzzles } from "../../src/db/schema.ts";
import { silentLogger } from "../../src/log/logger.ts";

export interface TableCounts {
  readonly puzzles: number;
  readonly puzzlesActive: number;
  readonly matches: number;
  readonly matchEvents: number;
}

export async function tableCounts(db: Database): Promise<TableCounts> {
  const total = async (table: typeof puzzles | typeof matches | typeof matchEvents) =>
    (await db.select({ n: count() }).from(table))[0]?.n ?? 0;
  const active = await db.select({ n: count() }).from(puzzles).where(isNull(puzzles.retiredAt));
  return {
    puzzles: await total(puzzles),
    puzzlesActive: active[0]?.n ?? 0,
    matches: await total(matches),
    matchEvents: await total(matchEvents),
  };
}

/**
 * Lo que no cuadra entre el origen (leído después del volcado) y lo restaurado: el banco igual, y
 * las partidas y los eventos (que solo crecen) como mucho los del origen y, sin partidas nuevas
 * durante el volcado, iguales.
 */
export function countProblems(source: TableCounts, restored: TableCounts): string[] {
  const problems: string[] = [];
  if (restored.puzzles !== source.puzzles) problems.push("puzzles");
  if (restored.puzzlesActive !== source.puzzlesActive) problems.push("puzzles_active");
  if (restored.puzzlesActive === 0) problems.push("empty_bank");
  if (restored.matches > source.matches) problems.push("matches");
  if (restored.matchEvents > source.matchEvents) problems.push("match_events");
  return problems;
}

/** Arranca el servidor sobre la base restaurada y dice cuántas partidas reconstruyó. */
export async function bootOn(db: Database): Promise<number> {
  await migrateDatabase(db, { guard: true });
  const app = await startApp({
    db,
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: ["https://restore-check.invalid"],
    logger: silentLogger,
    metricsIntervalMs: 0,
  });
  await app.stop();
  return app.restored;
}

/** Escribe los recuentos con un prefijo (`backup` o `restore`), en la forma de `quiet.ts`. */
export function printCounts(prefix: string, counts: TableCounts): void {
  console.log(`${prefix}.puzzles: ${String(counts.puzzles)}`);
  console.log(`${prefix}.puzzles_active: ${String(counts.puzzlesActive)}`);
  console.log(`${prefix}.matches: ${String(counts.matches)}`);
  console.log(`${prefix}.match_events: ${String(counts.matchEvents)}`);
}
