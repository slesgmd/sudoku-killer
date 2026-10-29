// Calificador, niveles 4 y 5. T-35.4: desde estados que todavía admiten la solución (dígitos
// correctos colocados y candidatos equivocados quitados al azar), ninguna técnica la contradice. Y
// cada técnica nueva deduce exactamente lo mismo que un oráculo por fuerza bruta escrito aparte, que
// no usa nada del calificador.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  TECHNIQUES,
  UNBOUNDED,
  UNIT_COMBINATION_BOUND,
  generatePuzzle,
  unitCombinationWithin,
  layoutOf,
  type Deduction,
  type Geometry,
  type Grid,
  type KillerPuzzle,
  type UnitCombinationBound,
} from "@sudoku-killer/engine";
import { at } from "../src/model/at.ts";
import { graderContextOf } from "../src/grader/context.ts";
import type { GraderState } from "../src/grader/state.ts";
import { agrees, expectCandidatesKeep, stateWith } from "./helpers/grader.ts";
import { GEOMETRY_4, GEOMETRY_6, GEOMETRY_9 } from "./helpers/grids.ts";
import { assertProperty } from "./helpers/property.ts";

const SLOW = { timeout: 120_000 };
const seedArb = fc.nat({ max: 0xffff_ffff });

/** Puzzle generado y un estado al azar que admite su solución. */
function scenarioArb(geometry: Geometry) {
  const cellCount = geometry.size * geometry.size;
  return fc.record({
    seed: seedArb,
    cells: fc.uniqueArray(fc.nat({ max: cellCount - 1 }), { maxLength: cellCount / 2 }),
    eliminations: fc.array(
      fc.tuple(fc.nat({ max: cellCount - 1 }), fc.integer({ min: 1, max: geometry.size })),
      { maxLength: cellCount * 4 },
    ),
  });
}

function scenario(
  geometry: Geometry,
  {
    seed,
    cells,
    eliminations,
  }: { seed: number; cells: number[]; eliminations: [number, number][] },
): { puzzle: KillerPuzzle; solution: Grid; state: GraderState } {
  const { puzzle, solution } = generatePuzzle({ seed, geometry });
  return { puzzle, solution, state: stateWith(puzzle, solution, cells, eliminations) };
}

function technique(id: string) {
  const found = TECHNIQUES.find((t) => t.id === id);
  if (!found) throw new Error(`No technique ${id}`);
  return found;
}

const key = (cell: number, digit: number): string => `${String(cell)}:${String(digit)}`;
const keysOf = (deductions: readonly Deduction[]): string[] =>
  deductions.map((d) => `${d.kind === "place" ? "+" : ""}${key(d.cell, d.digit)}`).sort();

// ---------------------------------------------------------------------------------------------
// Oráculos: geometría desde `layoutOf` y las jaulas del puzzle, todo por enumeración directa.

const bits = (mask: number): number[] => [...Array(16).keys()].filter((i) => (mask >> i) & 1);
const digitsIn = (mask: number): number[] => bits(mask).map((i) => i + 1);
const countBits = (mask: number): number => bits(mask).length;

interface Oracle {
  readonly size: number;
  readonly cellCount: number;
  readonly units: readonly (readonly number[])[];
  readonly cages: KillerPuzzle["cages"];
  readonly sees: (a: number, b: number) => boolean;
  readonly cand: (cell: number) => number;
  readonly value: (cell: number) => number;
  readonly out: Set<string>;
  readonly remove: (cell: number, mask: number) => void;
}

function oracle(puzzle: KillerPuzzle, state: GraderState): Oracle {
  const layout = layoutOf(puzzle);
  const cageOf = new Map<number, number>();
  puzzle.cages.forEach((cage, i) => {
    for (const cell of cage.cells) cageOf.set(cell, i);
  });
  const out = new Set<string>();
  const cand = (cell: number): number => at(state.candidates, cell);
  return {
    size: puzzle.size,
    cellCount: puzzle.size * puzzle.size,
    units: [...layout.rows, ...layout.cols, ...layout.boxes],
    cages: puzzle.cages,
    sees: (a, b) => a !== b && (at(layout.peers, a).includes(b) || cageOf.get(a) === cageOf.get(b)),
    cand,
    value: (cell) => at(state.values, cell),
    out,
    remove: (cell, mask) => {
      for (const digit of digitsIn(cand(cell) & mask)) out.add(key(cell, digit));
    },
  };
}

/** Subconjuntos de `items` de tamaño `k`, por máscara. */
function subsetsOf<T>(items: readonly T[], k: number): T[][] {
  const result: T[][] = [];
  for (let mask = 0; mask < 1 << items.length; mask++) {
    if (countBits(mask) === k) result.push(bits(mask).map((i) => at(items, i)));
  }
  return result;
}

function nakedOracle(o: Oracle, k: number): void {
  for (const group of [...o.units, ...o.cages.map((cage) => cage.cells)]) {
    for (const subset of subsetsOf(group, k)) {
      if (subset.some((c) => o.value(c) !== 0 || countBits(o.cand(c)) < 2)) continue;
      const union = subset.reduce((m, c) => m | o.cand(c), 0);
      if (countBits(union) !== k) continue;
      for (let cell = 0; cell < o.cellCount; cell++) {
        if (!subset.includes(cell) && subset.every((c) => o.sees(c, cell))) o.remove(cell, union);
      }
    }
  }
}

/** Asignaciones de `cells` (sin repetir dígito) que suman `sum`, con los candidatos del estado. */
function assignments(o: Oracle, cells: readonly number[], sum: number): number[][] {
  const result: number[][] = [];
  const walk = (i: number, acc: number[]): void => {
    if (i === cells.length) {
      if (acc.reduce((a, b) => a + b, 0) === sum) result.push([...acc]);
      return;
    }
    for (const digit of digitsIn(o.cand(at(cells, i)))) {
      if (!acc.includes(digit)) walk(i + 1, [...acc, digit]);
    }
  };
  walk(0, []);
  return result;
}

function requiredOf(o: Oracle, cells: readonly number[], sum: number): number {
  const all = assignments(o, cells, sum);
  if (all.length === 0) return 0;
  return all.reduce((m, a) => m & a.reduce((x, d) => x | (1 << (d - 1)), 0), (1 << o.size) - 1);
}

function placedMask(o: Oracle, cells: readonly number[]): number {
  return cells.reduce((m, c) => (o.value(c) === 0 ? m : m | (1 << (o.value(c) - 1))), 0);
}

function hiddenOracle(o: Oracle, k: number): void {
  const groups = [
    ...o.units.map((cells) => ({ cells, digits: (1 << o.size) - 1 })),
    ...o.cages.map(({ cells, sum }) => ({ cells, digits: requiredOf(o, cells, sum) })),
  ];
  for (const { cells, digits } of groups) {
    const missing = digitsIn(digits & ~placedMask(o, cells));
    const where = (d: number): number[] =>
      cells.filter((c) => o.value(c) === 0 && (o.cand(c) >> (d - 1)) & 1);
    const usable = missing.filter((d) => where(d).length >= 2 && where(d).length <= k);
    for (const subset of subsetsOf(usable, k)) {
      const spots = new Set(subset.flatMap(where));
      if (spots.size !== k) continue;
      const mask = subset.reduce((m, d) => m | (1 << (d - 1)), 0);
      for (const cell of spots) o.remove(cell, ~mask);
    }
  }
}

function holders(o: Oracle, unit: readonly number[], digit: number): number[] | null {
  if (unit.some((c) => o.value(c) === digit)) return null;
  return unit.filter((c) => o.value(c) === 0 && (o.cand(c) >> (digit - 1)) & 1);
}

function lockedOracle(o: Oracle): void {
  for (const unit of o.units) {
    for (let digit = 1; digit <= o.size; digit++) {
      const hs = holders(o, unit, digit);
      if (!hs || hs.length < 2) continue;
      for (let cell = 0; cell < o.cellCount; cell++) {
        if (hs.includes(cell) || o.value(cell) !== 0) continue;
        if (hs.every((h) => o.sees(h, cell))) o.remove(cell, 1 << (digit - 1));
      }
    }
  }
}

function cageUnitLockOracle(o: Oracle): void {
  const must = o.cages.map(() => 0);
  for (const unit of o.units) {
    for (let digit = 1; digit <= o.size; digit++) {
      const hs = holders(o, unit, digit);
      if (!hs || hs.length === 0) continue;
      const cages = new Set(hs.map((h) => o.cages.findIndex((cage) => cage.cells.includes(h))));
      const [only] = cages;
      if (cages.size === 1 && only !== undefined) must[only] = at(must, only) | (1 << (digit - 1));
    }
  }
  o.cages.forEach(({ cells, sum }, i) => {
    const digits = at(must, i) & ~requiredOf(o, cells, sum) & ~placedMask(o, cells);
    if (digits === 0) return;
    const valid = assignments(o, cells, sum).filter((a) =>
      digitsIn(digits).every((d) => a.includes(d)),
    );
    cells.forEach((cell, j) => {
      o.remove(cell, ~valid.reduce((m, a) => m | (1 << (at(a, j) - 1)), 0));
    });
  });
}

function fishOracle(o: Oracle, n: number): void {
  const { size } = o;
  const lines = [...Array(size).keys()];
  for (let digit = 1; digit <= size; digit++) {
    for (const cellAt of [
      (b: number, c: number) => b * size + c,
      (b: number, c: number) => c * size + b,
    ]) {
      const covers = (base: number): number[] | null => {
        if (lines.some((c) => o.value(cellAt(base, c)) === digit)) return null;
        return lines.filter(
          (c) => o.value(cellAt(base, c)) === 0 && (o.cand(cellAt(base, c)) >> (digit - 1)) & 1,
        );
      };
      for (const bases of subsetsOf(lines, n)) {
        const sets = bases.map(covers);
        if (sets.some((s) => !s || s.length < 2 || s.length > n)) continue;
        const union = new Set(sets.flatMap((s) => s ?? []));
        if (union.size !== n) continue;
        for (const cover of union) {
          for (const base of lines) {
            const cell = cellAt(base, cover);
            if (!bases.includes(base) && o.value(cell) === 0) o.remove(cell, 1 << (digit - 1));
          }
        }
      }
    }
  }
}

function yWingOracle(o: Oracle): void {
  const bivalue = [...Array(o.cellCount).keys()].filter(
    (c) => o.value(c) === 0 && countBits(o.cand(c)) === 2,
  );
  for (const pivot of bivalue) {
    const [a, b] = digitsIn(o.cand(pivot));
    for (const x of bivalue) {
      for (const y of bivalue) {
        if (x === y || !o.sees(pivot, x) || !o.sees(pivot, y)) continue;
        const [x1, x2] = digitsIn(o.cand(x));
        const c = x1 === a ? x2 : x2 === a ? x1 : undefined;
        if (c === undefined || c === b || a === undefined || b === undefined) continue;
        if (o.cand(y) !== ((1 << (b - 1)) | (1 << (c - 1)))) continue;
        for (let cell = 0; cell < o.cellCount; cell++) {
          if (
            cell !== x &&
            cell !== y &&
            o.value(cell) === 0 &&
            o.sees(x, cell) &&
            o.sees(y, cell)
          ) {
            o.remove(cell, 1 << (c - 1));
          }
        }
      }
    }
  }
}

/**
 * Todas las permutaciones de la unidad con sus candidatos en las que cada jaula que la toca cuadra.
 * Con cota, solo mira las unidades con hasta `maxOpenCages` jaulas abiertas (alguna celda vacía
 * dentro de la unidad) y hasta `maxCombinations` combinaciones: los repartos distintos de conjuntos
 * de dígitos entre las jaulas que aparecen en esas permutaciones.
 */
function unitCombinationOracle(
  o: Oracle,
  { maxOpenCages, maxCombinations }: UnitCombinationBound = UNBOUNDED,
): void {
  for (const unit of o.units) {
    if (unit.every((c) => countBits(o.cand(c)) === 1)) continue;
    const support = unit.map(() => 0);
    const cagesHere = o.cages.filter((cage) => cage.cells.some((c) => unit.includes(c)));
    const open = cagesHere.filter((cage) =>
      cage.cells.some((c) => unit.includes(c) && o.value(c) === 0),
    ).length;
    if (open > maxOpenCages) continue;
    const fits = (perm: readonly number[]): boolean =>
      cagesHere.every(({ cells, sum }) => {
        const inside = cells.filter((c) => unit.includes(c)).map((c) => at(perm, unit.indexOf(c)));
        const outside = cells.filter((c) => !unit.includes(c));
        const left = sum - inside.reduce((a, b) => a + b, 0);
        const walk = (i: number, used: number[], rest: number): boolean => {
          if (i === outside.length) return rest === 0;
          return digitsIn(o.cand(at(outside, i))).some(
            (d) => !used.includes(d) && walk(i + 1, [...used, d], rest - d),
          );
        };
        return walk(0, inside, left);
      });
    const combinations = new Set<string>();
    const permute = (i: number, perm: number[]): void => {
      if (i === unit.length) {
        if (!fits(perm)) return;
        perm.forEach((d, j) => (support[j] = at(support, j) | (1 << (d - 1))));
        const split = cagesHere.map(({ cells }) =>
          cells
            .filter((c) => unit.includes(c))
            .reduce((mask, c) => mask | (1 << (at(perm, unit.indexOf(c)) - 1)), 0),
        );
        combinations.add(split.join(","));
        return;
      }
      for (const d of digitsIn(o.cand(at(unit, i)))) {
        if (!perm.includes(d)) permute(i + 1, [...perm, d]);
      }
    };
    permute(0, []);
    if (combinations.size > maxCombinations) continue;
    unit.forEach((cell, j) => {
      if (o.value(cell) === 0) o.remove(cell, ~at(support, j));
    });
  }
}

const ORACLES: readonly [string, (o: Oracle) => void][] = [
  ["lockedCandidates", lockedOracle],
  [
    "nakedPair",
    (o) => {
      nakedOracle(o, 2);
    },
  ],
  [
    "hiddenPair",
    (o) => {
      hiddenOracle(o, 2);
    },
  ],
  ["cageUnitLock", cageUnitLockOracle],
  [
    "nakedTriple",
    (o) => {
      nakedOracle(o, 3);
    },
  ],
  [
    "hiddenTriple",
    (o) => {
      hiddenOracle(o, 3);
    },
  ],
  [
    "xWing",
    (o) => {
      fishOracle(o, 2);
    },
  ],
  ["yWing", yWingOracle],
  [
    "swordfish",
    (o) => {
      fishOracle(o, 3);
    },
  ],
  [
    "unitCombination",
    (o) => {
      unitCombinationOracle(o, UNIT_COMBINATION_BOUND);
    },
  ],
];

/** Cotas medidas en el corpus, más dos muy chicas para que la cota se note también en 4×4 y 6×6. */
const BOUNDS: readonly UnitCombinationBound[] = [
  UNBOUNDED,
  { maxOpenCages: 4, maxCombinations: 8 },
  { maxOpenCages: 5, maxCombinations: 16 },
  { maxOpenCages: 5, maxCombinations: 32 },
  { maxOpenCages: 3, maxCombinations: 2 },
  { maxOpenCages: 2, maxCombinations: 1 },
];
const boundName = ({ maxOpenCages, maxCombinations }: UnitCombinationBound): string =>
  `${String(maxOpenCages)}/${String(maxCombinations)}`;

// ---------------------------------------------------------------------------------------------

describe.each<[Geometry, number]>([
  [GEOMETRY_4, 100],
  [GEOMETRY_6, 60],
  [GEOMETRY_9, 30],
])("levels 4 and 5 from states that keep the solution ($size)", (geometry, numRuns) => {
  it("T-35.4: no technique contradicts the solution", SLOW, () => {
    assertProperty(
      fc.property(scenarioArb(geometry), (input) => {
        const { puzzle, solution, state } = scenario(geometry, input);
        expect(state.contradiction).toBe(false);
        expectCandidatesKeep(state, solution);
        const context = graderContextOf(puzzle);
        for (const t of TECHNIQUES) {
          for (const deduction of t.find(context, state)) {
            expect(agrees(deduction, solution), `${t.id} ${JSON.stringify(deduction)}`).toBe(true);
          }
        }
      }),
      { numRuns },
    );
  });
});

describe.each<[Geometry, number]>([
  [GEOMETRY_4, 100],
  [GEOMETRY_6, 40],
])("levels 4 and 5 against brute-force oracles ($size)", (geometry, numRuns) => {
  it.each(ORACLES)("%s finds exactly what its oracle finds", (id, run) => {
    assertProperty(
      fc.property(scenarioArb(geometry), (input) => {
        const { puzzle, state } = scenario(geometry, input);
        const o = oracle(puzzle, state);
        run(o);
        const found = technique(id).find(graderContextOf(puzzle), state);
        expect(keysOf(found)).toEqual([...o.out].sort());
      }),
      { numRuns },
    );
  });
});

describe.each<[Geometry, number]>([
  [GEOMETRY_4, 60],
  [GEOMETRY_6, 25],
])("bounded unitCombination against its oracle ($size)", (geometry, numRuns) => {
  it.each(BOUNDS.map((bound) => [boundName(bound), bound] as const))(
    "T-35.4: bound %s finds exactly what the oracle finds within the bound",
    (_, bound) => {
      assertProperty(
        fc.property(scenarioArb(geometry), (input) => {
          const { puzzle, state } = scenario(geometry, input);
          const o = oracle(puzzle, state);
          unitCombinationOracle(o, bound);
          const found = unitCombinationWithin(bound).find(graderContextOf(puzzle), state);
          expect(keysOf(found)).toEqual([...o.out].sort());
        }),
        { numRuns },
      );
    },
  );
});

describe("levels 4 and 5 against oracles (9x9, cheap oracles)", () => {
  const cheap = ORACLES.filter(([id]) => id !== "unitCombination");
  it.each(cheap)("%s finds exactly what its oracle finds", SLOW, (id, run) => {
    assertProperty(
      fc.property(scenarioArb(GEOMETRY_9), (input) => {
        const { puzzle, state } = scenario(GEOMETRY_9, input);
        const o = oracle(puzzle, state);
        run(o);
        const found = technique(id).find(graderContextOf(puzzle), state);
        expect(keysOf(found)).toEqual([...o.out].sort());
      }),
      { numRuns: 15 },
    );
  });
});

describe("the oracles see the patterns they check", () => {
  it("every level 4 and 5 technique deduces something in some 6x6 state", () => {
    // Si un oráculo nunca encuentra nada, la comparación de arriba no prueba nada.
    const seen = new Set<string>();
    const rng = fc.sample(scenarioArb(GEOMETRY_6), { numRuns: 400, seed: 46 });
    for (const input of rng) {
      const { puzzle, state } = scenario(GEOMETRY_6, input);
      const context = graderContextOf(puzzle);
      for (const [id] of ORACLES) {
        if (!seen.has(id) && technique(id).find(context, state).length > 0) seen.add(id);
      }
    }
    expect([...seen].sort()).toEqual(ORACLES.map(([id]) => id).sort());
  });

  it("each bound deduces something, and the small ones skip units the full technique uses", () => {
    // Sin esto, la comparación con cota podría pasar sin que la cota descarte ninguna unidad.
    const deduces = new Set<string>();
    const skips = new Set<string>();
    const rng = fc.sample(scenarioArb(GEOMETRY_6), { numRuns: 400, seed: 47 });
    for (const input of rng) {
      const { puzzle, state } = scenario(GEOMETRY_6, input);
      const context = graderContextOf(puzzle);
      const full = unitCombinationWithin(UNBOUNDED).find(context, state).length;
      for (const bound of BOUNDS) {
        const found = unitCombinationWithin(bound).find(context, state).length;
        if (found > 0) deduces.add(boundName(bound));
        if (found < full) skips.add(boundName(bound));
      }
    }
    expect([...deduces].sort()).toEqual(BOUNDS.map(boundName).sort());
    expect(skips).toContain("3/2");
    expect(skips).toContain("2/1");
  });
});
