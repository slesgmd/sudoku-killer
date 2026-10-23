// Generador de puzzles (F4d, SPEC R-20 y R-35). Puro: todo el azar sale de la semilla.
import type { Cage, Geometry, Given, Grid, KillerPuzzle } from "../types.ts";
import { at } from "../model/at.ts";
import { STANDARD_GEOMETRY, isValidGeometry } from "../model/geometry.ts";
import { MIN_CAGE_SIZE, validateStructure } from "../model/structure.ts";
import { validateSolution } from "../model/validate.ts";
import { solveA } from "../solver-a/solve.ts";
import { solveB } from "../solver-b/solve.ts";
import { partitionCages, recut, sideNeighbours, type CageSizeWeights } from "./cages.ts";
import { randomGrid } from "./grid.ts";
import { createRng, shuffle, type Rng } from "./rng.ts";

/** Por qué un puzzle tiene números iniciales (SPEC §2.2, R-20). */
export type GivensReason = "none" | "easy" | "uniqueness";

/** Cambia cuando un cambio del generador altera los puzzles que salen de una semilla. */
export const GENERATOR_VERSION = "1";

/** Presupuesto de nodos de `solveA` por llamada (medido en docs/motor.md). */
export const DEFAULT_MAX_NODES = 1000;

/** Pesos de los tamaños objetivo 2, 3, 4 y 5. */
export const DEFAULT_CAGE_SIZE_WEIGHTS: CageSizeWeights = [3, 4, 2, 1];

export const DEFAULT_MAX_ADJUSTMENTS = 40;
export const DEFAULT_MAX_CANDIDATES = 1000;

/** Cortes al azar que se prueban al reajustar un par de jaulas. */
const RECUT_ATTEMPTS = 20;
/** Celdas en conflicto que se prueban por ronda de reajuste. */
const ADJUST_CELLS = 4;

export interface GenerateOptions {
  /** Entero de 32 bits sin signo. La misma semilla y opciones dan el mismo puzzle (T-35.6). */
  readonly seed: number;
  readonly geometry?: Geometry;
  /** Números iniciales extra del nivel fácil (`givensReason: "easy"`). Por defecto 0. */
  readonly easyGivens?: number;
  /** Presupuesto de nodos de cada llamada a `solveA`; si se agota, el candidato se descarta. */
  readonly maxNodes?: number;
  /** Reajustes de jaulas antes de recurrir a números iniciales para la unicidad. */
  readonly maxAdjustments?: number;
  /** Candidatos que se intentan antes de rendirse con un `Error`. */
  readonly maxCandidates?: number;
  readonly cageSizeWeights?: CageSizeWeights;
}

export interface GenerationStats {
  /** Candidatos empezados, incluido el aceptado. */
  readonly candidates: number;
  /** Candidatos descartados porque `solveA` agotó el presupuesto. */
  readonly discarded: number;
  /** Particiones fallidas (una celda suelta sin jaula vecina posible), que se repitieron. */
  readonly partitionRetries: number;
  /** Reajustes de jaulas del puzzle aceptado. */
  readonly adjustments: number;
  /** Números iniciales agregados para la unicidad en el puzzle aceptado. */
  readonly uniquenessGivens: number;
  /** Nodos de `solveA` en todos los candidatos y de `solveB` en la verificación. */
  readonly nodesA: number;
  readonly nodesB: number;
}

export interface GeneratedPuzzle {
  readonly puzzle: KillerPuzzle;
  readonly solution: Grid;
  readonly givensReason: GivensReason;
  readonly stats: GenerationStats;
}

interface Settings {
  readonly geometry: Geometry;
  readonly easyGivens: number;
  readonly maxNodes: number;
  readonly maxAdjustments: number;
  readonly weights: CageSizeWeights;
}

interface Counters {
  partitionRetries: number;
  nodesA: number;
}

interface Accepted {
  readonly puzzle: KillerPuzzle;
  readonly grid: Grid;
  readonly adjustments: number;
  readonly uniquenessGivens: number;
}

function buildPuzzle(
  geometry: Geometry,
  grid: Grid,
  cages: readonly (readonly number[])[],
  givens: readonly Given[],
): KillerPuzzle {
  const sorted = [...cages].sort((a, b) => at(a, 0) - at(b, 0));
  const list: Cage[] = sorted.map((cells, id) => ({
    id,
    cells: [...cells],
    sum: cells.reduce((total, cell) => total + at(grid, cell), 0),
  }));
  const sortedGivens = [...givens].sort((a, b) => a.cell - b.cell);
  return { ...geometry, cages: list, givens: sortedGivens };
}

/**
 * Paso 5, con jaulas: vuelve a cortar la jaula de una celda donde difieren dos soluciones. Primero
 * la parte en dos (si tiene 4 o 5 celdas) y si no, la recorta junto con una jaula vecina. Las
 * jaulas salen de la cuadrícula, así que esta sigue siendo solución. Devuelve false si no encontró
 * ningún corte.
 */
function adjustCages(
  settings: Settings,
  rng: Rng,
  grid: Grid,
  cages: number[][],
  differing: number[],
): boolean {
  const { size } = settings.geometry;
  const owner = new Int32Array(grid.length);
  cages.forEach((cells, index) => {
    for (const cell of cells) owner[cell] = index;
  });

  for (const cell of shuffle(rng, differing).slice(0, ADJUST_CELLS)) {
    const own = at(owner, cell);
    const cage = at(cages, own);
    if (cage.length >= 2 * MIN_CAGE_SIZE) {
      const split = recut(grid, size, rng, cage, [cage], RECUT_ATTEMPTS);
      if (split) {
        cages.splice(own, 1, ...split);
        return true;
      }
    }
    const neighbours = [...new Set(cage.flatMap((c) => sideNeighbours(c, size)))]
      .map((c) => at(owner, c))
      .filter((other) => other !== own);
    for (const other of shuffle(rng, [...new Set(neighbours)])) {
      const pair = at(cages, other);
      const cut = recut(grid, size, rng, [...cage, ...pair], [cage, pair], RECUT_ATTEMPTS);
      if (cut) {
        cages[own] = cut[0];
        cages[other] = cut[1];
        return true;
      }
    }
  }
  return false;
}

/**
 * Un candidato: cuadrícula, jaulas y unicidad (pasos 1 a 5 del plan). Devuelve null si `solveA`
 * agotó el presupuesto en algún momento: el candidato se descarta entero.
 */
function candidate(settings: Settings, rng: Rng, counters: Counters): Accepted | null {
  const { geometry, maxNodes, maxAdjustments, weights } = settings;
  const grid = randomGrid(geometry, rng);
  let cages = partitionCages(grid, geometry.size, rng, weights);
  while (!cages) {
    counters.partitionRetries++;
    cages = partitionCages(grid, geometry.size, rng, weights);
  }

  const givens: Given[] = [];
  let adjustments = 0;
  for (;;) {
    const puzzle = buildPuzzle(geometry, grid, cages, givens);
    const result = solveA(puzzle, { maxNodes });
    counters.nodesA += result.nodes;
    if (result.exhausted) return null;
    if (result.count === 1) {
      return { puzzle, grid, adjustments, uniquenessGivens: givens.length };
    }
    const [first, second] = result.solutions;
    if (!first || !second) throw new Error("Solver A found no solution for a generated grid");
    const differing = first.flatMap((digit, cell) => (digit !== at(second, cell) ? [cell] : []));

    if (adjustments < maxAdjustments && adjustCages(settings, rng, grid, cages, differing)) {
      adjustments++;
      continue;
    }
    const cell = at(differing, rng.int(differing.length));
    givens.push({ cell, value: at(grid, cell) });
  }
}

function resolveSettings(options: GenerateOptions): Settings {
  const geometry = options.geometry ?? STANDARD_GEOMETRY;
  if (!isValidGeometry(geometry) || geometry.size < 4) {
    throw new RangeError("The generator needs a valid geometry of size 4 or more");
  }
  const easyGivens = options.easyGivens ?? 0;
  if (!Number.isInteger(easyGivens) || easyGivens < 0) {
    throw new RangeError(`Invalid easyGivens ${String(easyGivens)}`);
  }
  const maxAdjustments = options.maxAdjustments ?? DEFAULT_MAX_ADJUSTMENTS;
  if (!Number.isInteger(maxAdjustments) || maxAdjustments < 0) {
    throw new RangeError(`Invalid maxAdjustments ${String(maxAdjustments)}`);
  }
  return {
    geometry,
    easyGivens,
    // `solveA` comprueba el presupuesto; los pesos, `weightedIndex`.
    maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES,
    maxAdjustments,
    weights: options.cageSizeWeights ?? DEFAULT_CAGE_SIZE_WEIGHTS,
  };
}

/**
 * Genera un puzzle killer con solución única (SPEC R-20, plan F4):
 * 1. una cuadrícula completa aleatoria;
 * 2. jaulas conectadas de 2 a 5 celdas sin dígitos repetidos;
 * 3. sus sumas;
 * 4. unicidad con `solveA` y un presupuesto de nodos: si se agota, el candidato se descarta y se
 *    genera otro;
 * 5. si hay dos soluciones o más, se reajustan las jaulas donde difieren (hasta `maxAdjustments`
 *    veces) y, si no alcanza, se agrega un número inicial de la cuadrícula en una de esas celdas.
 *
 * El puzzle aceptado se verifica con `solveB`: tiene que ser único y con la misma solución. Una
 * discrepancia es un error de un solver y lanza `Error` (bloquea F4). Determinista: la misma semilla
 * y las mismas opciones dan el mismo resultado (T-35.6).
 */
export function generatePuzzle(options: GenerateOptions): GeneratedPuzzle {
  const settings = resolveSettings(options);
  const rng = createRng(options.seed);
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new RangeError(`Invalid maxCandidates ${String(maxCandidates)}`);
  }
  const counters: Counters = { partitionRetries: 0, nodesA: 0 };

  for (let candidates = 1; candidates <= maxCandidates; candidates++) {
    const accepted = candidate(settings, rng, counters);
    if (!accepted) continue;
    let { puzzle } = accepted;
    const { grid, adjustments, uniquenessGivens } = accepted;

    let givensReason: GivensReason = uniquenessGivens > 0 ? "uniqueness" : "none";
    if (settings.easyGivens > 0) {
      const free = shuffle(
        rng,
        grid.flatMap((_, cell) => (puzzle.givens.some((g) => g.cell === cell) ? [] : [cell])),
      );
      if (free.length < settings.easyGivens) {
        throw new RangeError(`Cannot add ${String(settings.easyGivens)} givens`);
      }
      const extra = free.slice(0, settings.easyGivens).map((cell) => ({
        cell,
        value: at(grid, cell),
      }));
      puzzle = { ...puzzle, givens: [...puzzle.givens, ...extra].sort((a, b) => a.cell - b.cell) };
      givensReason = "easy";
    }

    const structure = validateStructure(puzzle);
    const solution = validateSolution(puzzle, grid);
    if (structure.length > 0 || solution.length > 0) {
      throw new Error(`Generated an invalid puzzle (seed ${String(options.seed)})`);
    }
    const checked = solveB(puzzle);
    const [only] = checked.solutions;
    if (checked.count !== 1 || !only || only.some((digit, cell) => digit !== at(grid, cell))) {
      throw new Error(
        `Solver discrepancy: A says unique, B found ${String(checked.count)} (seed ${String(options.seed)})`,
      );
    }

    return {
      puzzle,
      solution: grid,
      givensReason,
      stats: {
        candidates,
        discarded: candidates - 1,
        partitionRetries: counters.partitionRetries,
        adjustments,
        uniquenessGivens,
        nodesA: counters.nodesA,
        nodesB: checked.nodes,
      },
    };
  }
  throw new Error(`No puzzle accepted after ${String(maxCandidates)} candidates`);
}
