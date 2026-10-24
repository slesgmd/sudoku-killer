// Carga del banco en la base de datos (ADR 0006): regenera cada semilla del manifiesto, comprueba
// que da el mismo puzzle y la misma calificación, e inserta lo que falta. Es idempotente: un puzzle
// ya cargado (mismo `hash`) no se vuelve a insertar. El manifiesto es el banco vigente: las filas
// que no están en él quedan retiradas (`retired_at`) y las que vuelven a estar se reactivan. Nunca
// se borra una fila, porque las partidas viejas apuntan a ella. Es un paso de despliegue, no del
// arranque: con el banco completo tarda unos minutos.
import { and, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { GRADER_VERSION } from "@sudoku-killer/engine";
import type { Database } from "../db/database.ts";
import { puzzles } from "../db/schema.ts";
import { assertCurrentManifest, type Manifest, type ManifestEntry } from "@sudoku-killer/bank";
import { verifyEntry } from "./bank.ts";
import { encodeSolution } from "./solution.ts";

/** Filas por sentencia `INSERT`. */
const BATCH = 100;

export interface LoadBankOptions {
  /** Se llama tras verificar cada entrada (para mostrar el avance). */
  readonly onEntry?: (entry: ManifestEntry, index: number) => void;
}

export interface LoadBankResult {
  readonly inserted: number;
  readonly existing: number;
  /** Filas que estaban retiradas y vuelven a estar en el manifiesto. */
  readonly reactivated: number;
  /** Filas vigentes que ya no están en el manifiesto. */
  readonly retired: number;
}

/**
 * Verifica todo el manifiesto y después escribe en una transacción. Si una entrada no coincide,
 * lanza `Error` con la semilla antes de escribir nada.
 */
export async function loadBank(
  db: Database,
  manifest: Manifest,
  { onEntry }: LoadBankOptions = {},
): Promise<LoadBankResult> {
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
      hash: entry.hash,
      mappingVersion: manifest.mappingVersion,
    };
  });
  const hashes = rows.map((row) => row.hash);

  return db.transaction(async (tx) => {
    let inserted = 0;
    let reactivated = 0;
    for (let start = 0; start < rows.length; start += BATCH) {
      const slice = rows.slice(start, start + BATCH);
      const added = await tx
        .insert(puzzles)
        .values(slice)
        .onConflictDoNothing({ target: puzzles.hash })
        .returning({ id: puzzles.id });
      inserted += added.length;
      const back = await tx
        .update(puzzles)
        .set({ retiredAt: null })
        .where(
          and(
            inArray(
              puzzles.hash,
              slice.map((row) => row.hash),
            ),
            isNotNull(puzzles.retiredAt),
          ),
        )
        .returning({ id: puzzles.id });
      reactivated += back.length;
    }
    const retired = await tx
      .update(puzzles)
      .set({ retiredAt: sql`now()` })
      .where(
        and(
          isNull(puzzles.retiredAt),
          hashes.length > 0 ? notInArray(puzzles.hash, hashes) : undefined,
        ),
      )
      .returning({ id: puzzles.id });
    return { inserted, existing: rows.length - inserted, reactivated, retired: retired.length };
  });
}
