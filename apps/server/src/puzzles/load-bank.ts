// Carga del banco en la base de datos (ADR 0006): regenera cada semilla del manifiesto, comprueba
// que da el mismo puzzle y la misma calificación, e inserta lo que falta. Es idempotente: una
// semilla ya cargada (misma versión del generador) no se vuelve a insertar. Es un paso de
// despliegue, no del arranque: con el banco completo tarda unos minutos.
import { GRADER_VERSION } from "@sudoku-killer/engine";
import type { Database } from "../db/database.ts";
import { puzzles } from "../db/schema.ts";
import { assertCurrentManifest, verifyEntry, type Manifest, type ManifestEntry } from "./bank.ts";
import { encodeSolution } from "./solution.ts";

/** Filas por sentencia `INSERT`. */
const BATCH = 100;

export interface LoadBankOptions {
  /** Se llama tras verificar cada entrada (para mostrar el avance). */
  readonly onEntry?: (entry: ManifestEntry, index: number) => void;
}

/**
 * Verifica todo el manifiesto y después inserta en una transacción. Si una entrada no coincide,
 * lanza `Error` con la semilla antes de escribir nada. Devuelve cuántas filas insertó.
 */
export async function loadBank(
  db: Database,
  manifest: Manifest,
  { onEntry }: LoadBankOptions = {},
): Promise<{ inserted: number; existing: number }> {
  assertCurrentManifest(manifest);
  const rows = manifest.entries.map((entry, index) => {
    const { generated, result } = verifyEntry(entry);
    onEntry?.(entry, index);
    const { puzzle, solution, givensReason } = generated;
    return {
      size: puzzle.size,
      boxRows: puzzle.boxRows,
      boxCols: puzzle.boxCols,
      difficulty: entry.difficulty,
      cages: puzzle.cages.map(({ id, cells, sum }) => ({ id, cells: [...cells], sum })),
      givens: puzzle.givens.map(({ cell, value }) => ({ cell, value })),
      solution: encodeSolution(solution),
      graderMaxLevel: result.maxLevel,
      graderSteps: result.steps,
      graderVersion: GRADER_VERSION,
      givensReason,
      generatorVersion: manifest.generatorVersion,
      seed: entry.seed,
    };
  });

  let inserted = 0;
  await db.transaction(async (tx) => {
    for (let start = 0; start < rows.length; start += BATCH) {
      const added = await tx
        .insert(puzzles)
        .values(rows.slice(start, start + BATCH))
        .onConflictDoNothing({ target: [puzzles.generatorVersion, puzzles.seed] })
        .returning({ id: puzzles.id });
      inserted += added.length;
    }
  });
  return { inserted, existing: rows.length - inserted };
}
