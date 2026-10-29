// Puntos de cada hecho de la partida (SPEC §5). Las funciones de `createScoring` tienen las firmas
// de `onCorrect`, `onMistake` y `onHint` de `GameMode`: sus contextos son tipos mínimos a los que el
// `PlacementContext` de la SPEC es asignable, así que el modo Normal las usa sin adaptarlas.
import { SCORED_LEVELS, type ScoringParams } from "./params.ts";

export type UnitKind = "row" | "col" | "box" | "cage";

/** Una unidad que la jugada completa (SPEC §5, `closedUnits`). */
export interface ClosedUnit {
  readonly unit: UnitKind;
  readonly index: number;
}

export type ScoreReason = "correct" | "closure" | "mistake" | "hint";

export interface ScoreChange<P extends string = string> {
  readonly playerId: P;
  readonly delta: number;
  readonly reason: ScoreReason;
}

/** Lo que `onCorrect` lee del `PlacementContext`. */
export interface CorrectContext<P extends string = string> {
  readonly playerId: P;
  readonly cell: number;
  readonly at: number;
  /** Calculado sobre el estado anterior a la jugada, con los descartes públicos (`docs/motor.md`). */
  readonly levelToDeduce: number;
  readonly closedUnits: readonly ClosedUnit[];
}

/** Lo que `onMistake` lee de su contexto. */
export interface MistakeContext<P extends string = string> {
  readonly playerId: P;
  readonly cell: number;
  readonly digit: number;
  readonly at: number;
}

/** Lo que `onHint` lee del `PlacementContext`. */
export interface HintContext<P extends string = string> {
  readonly playerId: P;
  readonly cell: number;
  readonly at: number;
}

export interface MistakeOutcome<P extends string = string> {
  readonly score: ScoreChange<P>[];
  readonly livesDelta: number;
}

export interface Scoring {
  /** `B × w(nivel)` y β por cada unidad cerrada, en el orden de `closedUnits`. */
  onCorrect<P extends string>(ctx: CorrectContext<P>): ScoreChange<P>[];
  /** −P y una vida menos. */
  onMistake<P extends string>(ctx: MistakeContext<P>): MistakeOutcome<P>;
  /** −H para quien la usa; nadie recibe β aunque la pista cierre unidades (T-19.5). */
  onHint<P extends string>(ctx: HintContext<P>): ScoreChange<P>[];
}

/**
 * Puntos de un acierto de nivel `level`, sin el bonus de cierre. Lanza `RangeError` si el nivel no
 * está entre 1 y 5: en el banco nunca es `UNRATED` (T-20.5), así que eso sería un error del servidor.
 */
export function pointsFor(level: number, { base, weights }: ScoringParams): number {
  const weight = Number.isInteger(level) ? weights[level - 1] : undefined;
  if (weight === undefined || level > SCORED_LEVELS) {
    throw new RangeError(
      `Level ${String(level)} does not score (expected 1 to ${String(SCORED_LEVELS)})`,
    );
  }
  return base * weight;
}

export function createScoring(params: ScoringParams): Scoring {
  return {
    onCorrect({ playerId, levelToDeduce, closedUnits }) {
      return [
        { playerId, delta: pointsFor(levelToDeduce, params), reason: "correct" },
        ...closedUnits.map(() => ({
          playerId,
          delta: params.closureBonus,
          reason: "closure" as const,
        })),
      ];
    },
    onMistake({ playerId }) {
      return {
        score: [{ playerId, delta: -params.mistakePenalty, reason: "mistake" }],
        livesDelta: -1,
      };
    },
    onHint({ playerId }) {
      return [{ playerId, delta: -params.hintPenalty, reason: "hint" }];
    },
  };
}
