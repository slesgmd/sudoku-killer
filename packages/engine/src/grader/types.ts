// Tipos del calificador humano (F4e y F4f): deducciones, técnicas y niveles (SPEC R-35, T-35.4 y T-35.5).
import type { GraderContext } from "./context.ts";
import type { GraderState } from "./state.ts";

/** Nivel más alto que implementa el calificador. */
export const MAX_TECHNIQUE_LEVEL = 5;

/**
 * Nivel de lo que excede las técnicas implementadas: un puzzle que el calificador no termina, o
 * una celda que no queda determinada. Es fijo (no depende de `MAX_TECHNIQUE_LEVEL`) para que los
 * niveles guardados no cambien de sentido al agregar técnicas.
 */
export const UNRATED = 6;

/** Una deducción: colocar un dígito en una celda o quitarlo de sus candidatos. */
export type Deduction =
  | { readonly kind: "place"; readonly cell: number; readonly digit: number }
  | { readonly kind: "eliminate"; readonly cell: number; readonly digit: number };

export type TechniqueId =
  | "nakedSingle"
  | "hiddenSingle"
  | "cageLastCell"
  | "cageCombination"
  | "cageForcedDigit"
  | "innieOutie"
  | "lockedCandidates"
  | "nakedPair"
  | "hiddenPair"
  | "cageUnitLock"
  | "nakedTriple"
  | "hiddenTriple"
  | "xWing"
  | "yWing"
  | "swordfish"
  | "unitCombination";

/**
 * Técnica aislada: lee el estado sin modificarlo y devuelve las deducciones que encuentra en él,
 * todas válidas a la vez. Solo devuelve deducciones que cambian el estado (no repite una celda
 * colocada ni un candidato ya quitado).
 */
export interface Technique {
  readonly id: TechniqueId;
  readonly level: number;
  readonly find: (context: GraderContext, state: GraderState) => readonly Deduction[];
}
