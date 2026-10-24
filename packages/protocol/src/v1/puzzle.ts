// Puzzle público (SPEC §2.2): lo único del banco que sale del servidor.
import { z } from "zod";
import { cellSchema, difficultySchema, digitSchema } from "./common.ts";

/** Jaula de 2 a 5 celdas con su suma (SPEC §2.2, P2). */
export const cageSchema = z.object({
  id: z.int().nonnegative(),
  cells: z.array(cellSchema).min(2).max(5),
  sum: z.int().positive(),
});

export const givenSchema = z.object({ cell: cellSchema, value: digitSchema });

/**
 * Puzzle público. Nunca lleva la solución (T-31.3) ni la semilla (T-20.4); el `id` es opaco.
 */
export const publicPuzzleSchema = z.object({
  id: z.string(),
  size: z.int().positive(),
  boxRows: z.int().positive(),
  boxCols: z.int().positive(),
  difficulty: difficultySchema,
  cages: z.array(cageSchema),
  givens: z.array(givenSchema),
});

export type PublicPuzzle = z.infer<typeof publicPuzzleSchema>;
