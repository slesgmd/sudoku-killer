// Modelo del mundo del simulador de la puntuación (F6, `docs/puntuacion.md`): cuánto tarda un bot en
// pensar cada celda, cómo elige y cuándo se equivoca. Son supuestos del simulador, no parámetros de
// la puntuación; la robustez se mide con perfiles de tiempos alternativos.
import { createRng, type Rng } from "@sudoku-killer/engine";

/** Segundos medianos para pensar una celda de nivel 1 a 5 (índice 0: nivel 1). */
export type TimeProfile = readonly [number, number, number, number, number];

export const TIME_PROFILES = {
  /** El perfil principal. */
  base: [6, 15, 35, 70, 140],
  /** Las técnicas difíciles cuestan menos de lo supuesto. */
  flat: [8, 14, 22, 32, 45],
  /** Las técnicas difíciles cuestan mucho más. */
  steep: [5, 15, 50, 120, 300],
} as const satisfies Record<string, TimeProfile>;

export type ProfileName = keyof typeof TIME_PROFILES;

export interface WorldModel {
  readonly times: TimeProfile;
  /** σ del ruido lognormal de cada tiempo de pensar. */
  readonly thinkSigma: number;
  /** Segundos que tarda un bot en notar que otro bloqueó su celda (R-05). */
  readonly reaction: number;
  /** Probabilidad de un descuido (dígito falso) en una jugada deducida. */
  readonly slip: number;
  readonly lives: number;
  readonly teamHints: number;
}

export function worldModel(profile: ProfileName): WorldModel {
  return {
    times: TIME_PROFILES[profile],
    thinkSigma: 0.5,
    reaction: 1.5,
    slip: 0.01,
    lives: 3,
    teamHints: 3,
  };
}

export type BotKind = "logic" | "fast" | "guesser";

export const BOT_KINDS: readonly BotKind[] = ["logic", "fast", "guesser"];

export interface BotSpec {
  readonly kind: BotKind;
  /** Multiplica todos sus tiempos: menos es más rápido. */
  readonly speed: number;
  /** Nivel de técnica más alto que usa: 5 para lógico y veloz, 2 o 3 para el adivinador. */
  readonly skill: number;
  /**
   * Probabilidad de pedir pista cuando todo lo que tiene a mano es de nivel ≥ 4 (o, el adivinador,
   * cuando no encuentra nada y antes de adivinar).
   */
  readonly hintProb: number;
}

/** Azar con semilla, con flotantes y normales (Box-Muller). */
export interface SimRng {
  int(bound: number): number;
  /** Uniforme en [0, 1). */
  float(): number;
  normal(): number;
  lognormal(sigma: number): number;
}

export function simRng(seed: number): SimRng {
  const rng: Rng = createRng(seed >>> 0);
  const float = (): number => rng.next() / 0x1_0000_0000;
  const normal = (): number => {
    const u = 1 - float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * float());
  };
  return {
    int: (bound) => rng.int(bound),
    float,
    normal,
    lognormal: (sigma) => Math.exp(sigma * normal()),
  };
}

/** Mezcla dos enteros en una semilla de 32 bits (para el flujo de cada bot). */
export function mixSeed(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (b + 0x7f4a7c15), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Un bot al azar de las mesas generales (bloque A). */
export function randomBot(rng: SimRng, kind?: BotKind): BotSpec {
  const roll = rng.float();
  const chosen: BotKind = kind ?? (roll < 0.45 ? "logic" : roll < 0.8 ? "fast" : "guesser");
  return {
    kind: chosen,
    speed: rng.lognormal(0.35),
    skill: chosen === "guesser" ? 2 + rng.int(2) : 5,
    hintProb: rng.float() < 0.3 ? 0.5 : 0,
  };
}
