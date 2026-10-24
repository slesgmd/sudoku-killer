// Metas de la puntuación (F6d, `docs/puntuacion.md`, decididas en el punto de control). Las metas
// exigidas: P y H según sus reglas, adivinar con EV negativo frente a deducir (con su intervalo de
// confianza en el nivel 2, y en media en el nivel 3), pistas y robo sin ganancia neta y β acotado. La equidad entre veloz y lógico y el Spearman
// se informan contra sus metas, pero son limitaciones conocidas de la v1: no bloquean.
import type { ScoringParams } from "@sudoku-killer/scoring";
import { againstCeiling, type Metrics, type ReliabilityMetrics } from "./metrics.ts";

export interface Check {
  readonly name: string;
  readonly value: string;
  readonly target: string;
  readonly pass: boolean;
  /** `false`: limitación conocida que se informa sin bloquear. */
  readonly required: boolean;
}

/** Puntos de diferencia máxima entre la cuota de puntaje y la de aporte (veloz y lógico). */
export const EQUITY_GAP = 5;
export const MIN_POOLED_SPEARMAN = 0.8;
/** Fracción del techo de confiabilidad que tendría que alcanzar cada estrato. */
export const MIN_CEILING_RATIO = 0.8;
export const MAX_CLOSURE_SHARE = 0.2;
/** Nivel del adivinador que cubre la condición de P: P > B·(w(5) + w(s)). */
export const GUESSER_LEVEL_COVERED = 3;

const f = (x: number, digits = 2): string => (Number.isFinite(x) ? x.toFixed(digits) : String(x));

/** La condición analítica de P para un adivinador de nivel s: B·(w(5) + w(s)). */
export function guessThreshold({ base, weights }: ScoringParams, s: number): number {
  return base * ((weights[4] ?? 0) + (weights[s - 1] ?? 0));
}

/** La mayor diferencia de cuota entre puntaje y aporte del veloz y del lógico. */
export function fastLogicGap({ equity }: Metrics): number {
  const { general, duel } = equity;
  return Math.max(
    Math.abs(general.fast.score - general.fast.aporte),
    Math.abs(general.logic.score - general.logic.aporte),
    Math.abs(duel.score - duel.aporte),
    Math.abs(duel.winRate - duel.aporteWinRate),
  );
}

export function checkTargets(
  metrics: Metrics,
  reliable: ReliabilityMetrics,
  params: ScoringParams,
): Check[] {
  const { correlation, guessing, hints, closureShare } = metrics;
  const ceiling = againstCeiling(correlation, reliable);
  const threshold = guessThreshold(params, GUESSER_LEVEL_COVERED);
  const hintRule = params.base * (params.weights[4] ?? 0) + 10;
  const checks: Check[] = [
    {
      name: `P > B·(w(5) + w(${String(GUESSER_LEVEL_COVERED)}))`,
      value: `${String(params.mistakePenalty)} > ${String(threshold)}`,
      target: "cumple",
      pass: params.mistakePenalty > threshold,
      required: true,
    },
    {
      name: "H = B·w(5) + 10",
      value: String(params.hintPenalty),
      target: String(hintRule),
      pass: params.hintPenalty === hintRule,
      required: true,
    },
  ];
  // Nivel 2: la media y el intervalo de confianza, negativos. Nivel 3: la media negativa; su
  // alternativa es deducir celdas de nivel 4 o 5 (de 70 a 140 s), así que queda cerca del límite y su
  // intervalo se informa sin exigirlo (decisión del punto de control, `docs/puntuacion.md`).
  const level2 = guessing.bySkill[2];
  const level3 = guessing.bySkill[3];
  const describe = (x: typeof level2) =>
    x
      ? `media ${f(x.delta.mean, 1)}, IC 95 % superior ${f(x.delta.upper95, 1)}, n ${String(x.delta.n)}`
      : "sin datos";
  checks.push(
    {
      name: "Adivinar frente a deducir (nivel 2): IC 95 % superior",
      value: describe(level2),
      target: "< 0",
      pass: level2 !== undefined && level2.delta.upper95 < 0,
      required: true,
    },
    {
      name: "Adivinar frente a deducir (nivel 3): media",
      value: describe(level3),
      target: "< 0",
      pass: level3 !== undefined && level3.delta.mean < 0,
      required: true,
    },
    {
      name: "Adivinar frente a deducir (nivel 3): IC 95 % superior",
      value: describe(level3),
      target: "< 0",
      pass: level3 !== undefined && level3.delta.upper95 < 0,
      required: false,
    },
  );
  checks.push(
    {
      name: "Pista, efecto neto sobre el propio puntaje (media)",
      value: `${f(hints.netSelf.mean, 1)} (IC 95 % superior ${f(hints.netSelf.upper95, 1)})`,
      target: "≤ 0",
      pass: hints.netSelf.mean <= 0,
      required: true,
    },
    {
      name: "Robo, efecto neto (propio − víctima, media)",
      value: `${f(hints.netSteal.mean, 1)} (IC 95 % superior ${f(hints.netSteal.upper95, 1)}, n ${String(hints.netSteal.n)})`,
      target: "≤ 0",
      pass: hints.netSteal.mean <= 0,
      required: true,
    },
    {
      name: "β en los puntos de la partida (p95)",
      value: `${f(100 * closureShare.p95, 1)} %`,
      target: `≤ ${String(100 * MAX_CLOSURE_SHARE)} %`,
      pass: closureShare.p95 <= MAX_CLOSURE_SHARE,
      required: true,
    },
    {
      name: "Equidad veloz y lógico (máxima diferencia de cuota)",
      value: f(fastLogicGap(metrics), 1),
      target: `≤ ${String(EQUITY_GAP)}`,
      pass: fastLogicGap(metrics) <= EQUITY_GAP,
      required: false,
    },
    {
      name: "Spearman agrupado",
      value: f(correlation.pooled),
      target: `≥ ${String(MIN_POOLED_SPEARMAN)}`,
      pass: correlation.pooled >= MIN_POOLED_SPEARMAN,
      required: false,
    },
    {
      name: "Spearman por estrato / techo (mínimo)",
      value: f(ceiling.minRatio),
      target: `≥ ${String(MIN_CEILING_RATIO)}`,
      pass: ceiling.minRatio >= MIN_CEILING_RATIO,
      required: false,
    },
  );
  return checks;
}
