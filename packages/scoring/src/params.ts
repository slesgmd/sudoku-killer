// Parámetros de la puntuación (F6, `docs/puntuacion.md`). Se versionan: una partida guarda la
// versión con que se puntuó (`scoringParamsVersion`) y se puede recalcular con otra (T-32.4).
import { z } from "zod";
import v1 from "./params.v1.json" with { type: "json" };

/**
 * Niveles de técnica que puntúan: de 1 a 5. Es `MAX_TECHNIQUE_LEVEL` del motor; se repite aquí para
 * que la puntuación no dependa del motor, y una prueba comprueba que coinciden.
 */
export const SCORED_LEVELS = 5;

export const scoringParamsSchema = z
  .object({
    version: z.string().min(1),
    /** B: puntos de una celda de nivel 1 con w = 1. */
    base: z.int().positive(),
    /** w(L) para L de 1 a 5, en orden; no decrece. */
    weights: z.array(z.number().positive()).length(SCORED_LEVELS),
    /** P: lo que resta un error, además de la vida. */
    mistakePenalty: z.int().nonnegative(),
    /** β: lo que suma cada unidad (fila, columna, caja o jaula) que cierra un acierto. */
    closureBonus: z.int().nonnegative(),
    /** H: lo que resta una pista a quien la usa. */
    hintPenalty: z.int().nonnegative(),
  })
  .refine(({ weights }) => weights.every((w, i) => i === 0 || w >= (weights[i - 1] ?? w)), {
    message: "weights must not decrease",
  })
  .refine(({ base, weights }) => weights.every((w) => Number.isInteger(base * w)), {
    message: "base × weight must be an integer for every level",
  });

export type ScoringParams = z.infer<typeof scoringParamsSchema>;

/** Valida unos parámetros; lanza `ZodError` si no cumplen el esquema. */
export function parseScoringParams(input: unknown): ScoringParams {
  return Object.freeze(scoringParamsSchema.parse(input));
}

/** Los parámetros vigentes (`params.v1.json`). */
export const PARAMS_V1: ScoringParams = parseScoringParams(v1);
