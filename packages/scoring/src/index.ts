// Puntuación pura y parametrizada (`docs/puntuacion.md`). Sin reloj ni azar.

export {
  PARAMS_V1,
  SCORED_LEVELS,
  parseScoringParams,
  scoringParamsSchema,
  type ScoringParams,
} from "./params.ts";
export {
  createScoring,
  pointsFor,
  type ClosedUnit,
  type CorrectContext,
  type HintContext,
  type MistakeContext,
  type MistakeOutcome,
  type ScoreChange,
  type ScoreReason,
  type Scoring,
  type UnitKind,
} from "./score.ts";
export { changesOf, scoreLog, type PlayerTally, type ScoringEvent } from "./log.ts";
export { rankPlayers, type RankedEntry, type RankingInput } from "./ranking.ts";
