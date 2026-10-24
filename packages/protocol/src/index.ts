// Mensajes y esquemas del protocolo (SPEC §4). Nada de lo que se exporta aquí puede llevar
// la solución (T-31.3).
import { z } from "zod";

/** Versión del protocolo que acepta el servidor de la v1 (SPEC §4.7). */
export const PROTOCOL_VERSION = 1;

export const protocolVersionSchema = z.literal(PROTOCOL_VERSION);

/** Dificultades del juego, de la más fácil a la más difícil (SPEC §2.2). */
export const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;

export const difficultySchema = z.enum(DIFFICULTIES);

export type Difficulty = z.infer<typeof difficultySchema>;

/** Jaula de 2 a 5 celdas con su suma (SPEC §2.2, P2). */
export const cageSchema = z.object({
  id: z.int().nonnegative(),
  cells: z.array(z.int().nonnegative()).min(2).max(5),
  sum: z.int().positive(),
});

export const givenSchema = z.object({ cell: z.int().nonnegative(), value: z.int().positive() });

/**
 * Puzzle público: lo único del banco que sale del servidor (SPEC §2.2). Nunca lleva la solución
 * (T-31.3) ni la semilla (T-20.4); el `id` es opaco.
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
