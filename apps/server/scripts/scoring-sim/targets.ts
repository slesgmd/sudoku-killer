// Metas de la puntuación (F6d, `docs/puntuacion.md`, aprobadas en el punto de control): equidad
// frente al aporte, Spearman relativo al techo de confiabilidad, adivinar con EV negativo, pistas sin
// ganancia y β acotado. Cada meta se evalúa con los mismos registros, así que la calibración y la
// validación usan la misma lista.
import type { ScoringParams } from "@sudoku-killer/scoring";
import { againstCeiling, type Metrics, type ReliabilityMetrics } from "./metrics.ts";

export interface Check {
  readonly name: string;
  readonly value: string;
  readonly target: string;
  readonly pass: boolean;
}

/** Puntos de diferencia máxima entre la cuota de puntaje y la de aporte. */
export const EQUITY_GAP = 5;
export const MIN_POOLED_SPEARMAN = 0.8;
/** Fracción del techo de confiabilidad que tiene que alcanzar cada estrato. */
export const MIN_CEILING_RATIO = 0.8;
export const MAX_CLOSURE_SHARE = 0.2;

const f = (x: number, digits = 2): string => (Number.isFinite(x) ? x.toFixed(digits) : String(x));

/** P mínimo de la condición analítica para adivinadores de nivel s ≤ 2: P > B·(w(5) + w(2)). */
export function guessThreshold({ base, weights }: ScoringParams, s = 2): number {
  return base * ((weights[4] ?? 0) + (weights[s - 1] ?? 0));
}

export function checkTargets(
  metrics: Metrics,
  reliable: ReliabilityMetrics,
  params: ScoringParams,
): Check[] {
  const { equity, correlation, guessing, hints, closureShare } = metrics;
  const ceiling = againstCeiling(correlation, reliable);
  const checks: Check[] = [
    {
      name: "Equidad (máxima diferencia de cuota)",
      value: f(equity.maxGap, 1),
      target: `≤ ${String(EQUITY_GAP)}`,
      pass: equity.maxGap <= EQUITY_GAP,
    },
    {
      name: "Spearman agrupado",
      value: f(correlation.pooled),
      target: `≥ ${String(MIN_POOLED_SPEARMAN)}`,
      pass: correlation.pooled >= MIN_POOLED_SPEARMAN,
    },
    {
      name: "Spearman por estrato / techo (mínimo)",
      value: f(ceiling.minRatio),
      target: `≥ ${String(MIN_CEILING_RATIO)}`,
      pass: ceiling.minRatio >= MIN_CEILING_RATIO,
    },
    {
      name: "P > B·(w(5) + w(2))",
      value: `${String(params.mistakePenalty)} > ${String(guessThreshold(params))}`,
      target: "cumple",
      pass: params.mistakePenalty > guessThreshold(params),
    },
    {
      name: "H = B·w(5) + 10",
      value: String(params.hintPenalty),
      target: String(params.base * (params.weights[4] ?? 0) + 10),
      pass: params.hintPenalty === params.base * (params.weights[4] ?? 0) + 10,
    },
  ];
  for (const [skill, x] of Object.entries(guessing.bySkill)) {
    checks.push(
      {
        name: `Adivinar, episodios (nivel ${skill}): IC 95 % superior`,
        value: `${f(x.episodes.upper95, 1)} (media ${f(x.episodes.mean, 1)}, n ${String(x.episodes.n)})`,
        target: "< 0",
        pass: x.episodes.upper95 < 0,
      },
      {
        name: `Adivinar frente a deducir (nivel ${skill}): IC 95 % superior`,
        value: `${f(x.delta.upper95, 1)} (media ${f(x.delta.mean, 1)}, n ${String(x.delta.n)})`,
        target: "< 0",
        pass: x.delta.upper95 < 0,
      },
    );
  }
  checks.push(
    {
      name: "Pista, efecto neto sobre el propio puntaje: IC 95 % superior",
      value: `${f(hints.netSelf.upper95, 1)} (media ${f(hints.netSelf.mean, 1)})`,
      target: "< 0",
      pass: hints.netSelf.upper95 < 0,
    },
    {
      name: "Robo, efecto neto (propio − víctima): IC 95 % superior",
      value: `${f(hints.netSteal.upper95, 1)} (media ${f(hints.netSteal.mean, 1)}, n ${String(hints.netSteal.n)})`,
      target: "< 0",
      pass: hints.netSteal.upper95 < 0,
    },
    {
      name: "β en los puntos de la partida (p95)",
      value: `${f(100 * closureShare.p95, 1)} %`,
      target: `≤ ${String(100 * MAX_CLOSURE_SHARE)} %`,
      pass: closureShare.p95 <= MAX_CLOSURE_SHARE,
    },
  );
  return checks;
}
