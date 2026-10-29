// Interfaz `GameMode` (SPEC §5): todo lo que es propio del modo (permisos, vidas, puntuación,
// pistas, resultado y ranking). Un modo no lee el reloj ni genera azar: el tiempo le llega en el
// contexto, desde el evento.
import type { ClosedUnit, MistakeOutcome, ScoreChange } from "@sudoku-killer/scoring";
import type { RankingEntry, Role } from "@sudoku-killer/protocol";
import type { Action, ModeRules } from "./permissions.ts";
import type { MatchState, PlayerId } from "./types.ts";

export interface PlacementContext {
  /** Estado ANTES de aplicar. */
  readonly state: Readonly<MatchState>;
  readonly playerId: PlayerId;
  readonly cell: number;
  readonly value: number;
  readonly at: number;
  /** Unidades que esta jugada completa, en el orden fila, columna, caja y jaula. */
  readonly closedUnits: readonly ClosedUnit[];
  /** `levelToDeduce` con los descartes públicos, guardado en el evento. */
  readonly levelToDeduce: number;
}

export interface MistakeContext {
  readonly state: Readonly<MatchState>;
  readonly playerId: PlayerId;
  readonly cell: number;
  readonly digit: number;
  readonly at: number;
}

export interface GameMode {
  readonly id: string;
  readonly rules: ModeRules;
  /** Versión de los parámetros de puntuación con que se juega (`Match.scoringParamsVersion`). */
  readonly scoringParamsVersion: string;
  can(role: Role, action: Action): boolean;
  /** Incluye el bonus de cierre. */
  onCorrect(ctx: PlacementContext): ScoreChange[];
  onMistake(ctx: MistakeContext): MistakeOutcome;
  onHint(ctx: PlacementContext): ScoreChange[];
  roleAfterLives(lives: number): Role;
  outcome(state: Readonly<MatchState>): "victory" | "defeat" | null;
  ranking(state: Readonly<MatchState>): RankingEntry[];
}
