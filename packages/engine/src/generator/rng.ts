// Generador pseudoaleatorio con semilla. El motor no puede usar `Math.random()` (ADR 0004): todo el
// azar del generador sale de aquí, así que la misma semilla da siempre el mismo puzzle (T-35.6).
import { at } from "../model/at.ts";

export interface Rng {
  /** Entero de 32 bits sin signo. */
  next(): number;
  /** Entero uniforme en `0..bound − 1`, con `bound` entero entre 1 y 2³². */
  int(bound: number): number;
}

const TWO_32 = 0x1_0000_0000;

/** Semillas válidas: enteros de 32 bits sin signo. */
export function isValidSeed(seed: number): boolean {
  return Number.isInteger(seed) && seed >= 0 && seed < TWO_32;
}

/** SplitMix32: expande la semilla en el estado inicial, para que semillas vecinas no se parezcan. */
function splitMix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/**
 * SFC32 (Small Fast Counting, de PractRand): rápido, con período de al menos 2³² y buena
 * calidad estadística para un generador de puzzles. Lanza `RangeError` si la semilla no es válida.
 */
export function createRng(seed: number): Rng {
  if (!isValidSeed(seed)) throw new RangeError(`Invalid seed ${String(seed)}`);
  const init = splitMix32(seed);
  let a = init();
  let b = init();
  let c = init();
  let d = init();
  const next = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  // Se descartan las primeras salidas, como recomienda el autor, para mezclar el estado.
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    int(bound: number): number {
      if (!Number.isInteger(bound) || bound < 1 || bound > TWO_32) {
        throw new RangeError(`Invalid bound ${String(bound)}`);
      }
      // Muestreo por rechazo: sin el sesgo del módulo.
      const limit = TWO_32 - (TWO_32 % bound);
      for (;;) {
        const value = next();
        if (value < limit) return value % bound;
      }
    },
  };
}

/** Mezcla `list` en su lugar (Fisher-Yates) y la devuelve. */
export function shuffle<T>(rng: Rng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const value = at(list, i);
    list[i] = at(list, j);
    list[j] = value;
  }
  return list;
}

/** Índice elegido con probabilidad proporcional a su peso (pesos ≥ 0, alguno positivo). */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0) || weights.some((weight) => !(weight >= 0) || !Number.isInteger(weight))) {
    throw new RangeError("Weights must be non-negative integers with a positive total");
  }
  let ticket = rng.int(total);
  for (const [index, weight] of weights.entries()) {
    if (ticket < weight) return index;
    ticket -= weight;
  }
  throw new RangeError("Unreachable: the ticket is below the total");
}
