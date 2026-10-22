// T-35.2: puzzles de referencia. No hay una fuente pública legible por máquina que se pueda usar
// (no se hacen más cargas de sudoku.com), así que se construyeron a partir de cuadrículas válidas
// (`killerArb` de test/helpers/grids.ts, con las semillas indicadas en `origin`). El resultado
// esperado, todas las soluciones, lo calcularon solveA y solveB con `limit: Infinity`, que
// coincidieron, y lo confirmó validateSolution. Nada se escribió de memoria.
//
// Formato: una cadena por fila. En `cages`, cada letra es una jaula, en orden de su primera celda;
// `sums` va en ese mismo orden. En `givens` y en las soluciones, un dígito por celda ("." vacía).
import type { Cage, Geometry, Given, Grid, KillerPuzzle } from "@sudoku-killer/engine";
import { GEOMETRY_4, GEOMETRY_6, GEOMETRY_9 } from "../helpers/grids.ts";

export interface ReferenceCase {
  readonly name: string;
  /** Cómo se construyó. */
  readonly origin: string;
  readonly geometry: Geometry;
  readonly cages: readonly string[];
  readonly sums: readonly number[];
  readonly givens: readonly string[];
  /** Todas las soluciones, ordenadas. */
  readonly solutions: readonly (readonly string[])[];
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Caracteres de filas ASCII, una celda por carácter. */
function cellsOf(rows: readonly string[]): string[] {
  const text = rows.join("");
  return Array.from({ length: text.length }, (_, i) => text.charAt(i));
}

export function toPuzzle(reference: ReferenceCase): KillerPuzzle {
  const cells = cellsOf(reference.cages);
  const cages: Cage[] = reference.sums.map((sum, id) => ({
    id,
    cells: cells.flatMap((letter, cell) => (letter === LETTERS[id] ? [cell] : [])),
    sum,
  }));
  const givens: Given[] = cellsOf(reference.givens).flatMap((char, cell) =>
    char === "." ? [] : [{ cell, value: Number(char) }],
  );
  return { ...reference.geometry, cages, givens };
}

export function toGrid(rows: readonly string[]): Grid {
  return cellsOf(rows).map(Number);
}

export const REFERENCE_CASES: readonly ReferenceCase[] = [
  {
    name: "4x4 unique without givens",
    origin: "killerArb(4x4), seed 2026, sample 12: the first one with a single solution",
    geometry: GEOMETRY_4,
    cages: ["AABB", "CCCD", "EFFD", "EEGG"],
    sums: [6, 4, 6, 6, 9, 4, 5],
    givens: ["....", "....", "....", "...."],
    solutions: [["2413", "1324", "4132", "3241"]],
  },
  {
    name: "4x4 with 2 to 4 solutions",
    origin:
      "killerArb(4x4), seed 2027, sample 0, with givens from its grid until 2 to 4 solutions remain",
    geometry: GEOMETRY_4,
    cages: ["ABCC", "ABCC", "DBEE", "DDDE"],
    sums: [7, 7, 10, 10, 6],
    givens: [".2..", "....", "1...", "...."],
    solutions: [
      ["3214", "4123", "1432", "2341"],
      ["3214", "4132", "1423", "2341"],
      ["4213", "3124", "1432", "2341"],
    ],
  },
  {
    name: "4x4 without solution: board total off by one",
    origin:
      "killerArb(4x4), seed 2028, sample 1 (the first one with a cage of fewer than 4 cells), a cage sum shifted by one",
    geometry: GEOMETRY_4,
    cages: ["AABB", "CCDD", "EEFF", "GGHH"],
    sums: [6, 3, 3, 7, 3, 7, 7, 3],
    givens: ["....", "....", "....", "...."],
    solutions: [],
  },
  {
    name: "6x6 unique without givens",
    origin: "killerArb(6x6), seed 2026, sample 12: the first one with a single solution",
    geometry: GEOMETRY_6,
    cages: ["ABBCCD", "AEEFFD", "AGGHHI", "JJKKLI", "MMNNLO", "PPQQLO"],
    sums: [8, 7, 7, 9, 10, 5, 9, 6, 8, 6, 5, 12, 11, 7, 4, 6, 6],
    givens: ["......", "......", "......", "......", "......", "......"],
    solutions: [["325614", "164235", "436152", "512346", "653421", "241563"]],
  },
  {
    name: "6x6 with 2 to 4 solutions",
    origin:
      "killerArb(6x6), seed 2027, sample 0, with givens from its grid until 2 to 4 solutions remain",
    geometry: GEOMETRY_6,
    cages: ["AAABBC", "DAACCC", "DDEFFF", "DEEGFF", "HIIGJJ", "HHHGJJ"],
    sums: [15, 5, 16, 14, 13, 16, 8, 14, 7, 18],
    givens: ["5.....", "......", "2.4...", ".6....", "32....", "......"],
    solutions: [
      ["532416", "641325", "254631", "163542", "325164", "416253"],
      ["541326", "632415", "254631", "163542", "325164", "416253"],
      ["541326", "632451", "254613", "163542", "325164", "416235"],
    ],
  },
  {
    name: "6x6 without solution: board total off by one",
    origin:
      "killerArb(6x6), seed 2028, sample 0 (the first one with a cage of fewer than 6 cells), a cage sum shifted by one",
    geometry: GEOMETRY_6,
    cages: ["ABBBCC", "AABDCC", "EABDFF", "EEDDFF", "GHHHIF", "GGHHII"],
    sums: [14, 15, 16, 14, 14, 18, 8, 20, 8],
    givens: ["......", "......", "......", "......", "......", "......"],
    solutions: [],
  },
  {
    name: "6x6 unique with givens",
    origin:
      "the 6x6 case with 2 to 4 solutions, with givens from its grid until one solution remains",
    geometry: GEOMETRY_6,
    cages: ["AAABBC", "DAACCC", "DDEFFF", "DEEGFF", "HIIGJJ", "HHHGJJ"],
    sums: [15, 5, 16, 14, 13, 16, 8, 14, 7, 18],
    givens: ["54....", "....1.", "2.4...", ".6....", "32....", "......"],
    solutions: [["541326", "632415", "254631", "163542", "325164", "416253"]],
  },
  {
    name: "6x6 without solution: a wrong given",
    origin: "the 6x6 unique case with givens, plus a given that differs from its solution",
    geometry: GEOMETRY_6,
    cages: ["AAABBC", "DAACCC", "DDEFFF", "DEEGFF", "HIIGJJ", "HHHGJJ"],
    sums: [15, 5, 16, 14, 13, 16, 8, 14, 7, 18],
    givens: ["542...", "....1.", "2.4...", ".6....", "32....", "......"],
    solutions: [],
  },
  {
    name: "9x9 unique without givens",
    origin: "killerArb(9x9), seed 2026, sample 2: the first one with a single solution",
    geometry: GEOMETRY_9,
    cages: [
      "AABBCCDEE",
      "FBBGCHDII",
      "FFBGJHKKL",
      "FMMGJNKLL",
      "FOOJJNNNP",
      "QOORJNSSP",
      "QOTRUSSVP",
      "WWTXUYSVZ",
      "WWTXYYYVZ",
    ],
    sums: [
      5, 35, 13, 13, 12, 26, 20, 4, 9, 18, 11, 11, 10, 31, 20, 22, 17, 7, 25, 6, 17, 9, 24, 8, 19,
      13,
    ],
    givens: [
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
    ],
    solutions: [
      [
        "146827593",
        "359641872",
        "287953614",
        "728539461",
        "614278359",
        "935416287",
        "872395146",
        "461782935",
        "593164728",
      ],
    ],
  },
  {
    name: "9x9 with 2 to 4 solutions",
    origin:
      "killerArb(9x9), seed 2027, sample 0, with givens from its grid until 2 to 4 solutions remain",
    geometry: GEOMETRY_9,
    cages: [
      "ABCCCDEFF",
      "ABCCGDEFF",
      "HBIIGJEKF",
      "HHLIIJMKK",
      "NLLIOOMPQ",
      "NLRROOSPQ",
      "NLTROUSVQ",
      "WTTRUUXVX",
      "WWTRUUXXX",
    ],
    sums: [
      10, 10, 29, 5, 10, 27, 9, 18, 24, 6, 20, 28, 9, 9, 32, 10, 14, 23, 13, 16, 27, 7, 24, 25,
    ],
    givens: [
      ".3.......",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      "7........",
      ".........",
    ],
    solutions: [
      [
        "438972516",
        "651483279",
        "927615384",
        "276541893",
        "389267145",
        "514398762",
        "143829657",
        "765134928",
        "892756431",
      ],
      [
        "638472519",
        "451983276",
        "927615384",
        "276541893",
        "389267145",
        "514398762",
        "143829657",
        "765134928",
        "892756431",
      ],
      [
        "638472591",
        "451983276",
        "927615384",
        "276541839",
        "389267145",
        "514398762",
        "143829657",
        "765134928",
        "892756413",
      ],
    ],
  },
  {
    name: "9x9 without solution: board total off by one",
    origin:
      "killerArb(9x9), seed 2028, sample 0 (the first one with a cage of fewer than 9 cells), a cage sum shifted by one",
    geometry: GEOMETRY_9,
    cages: [
      "AAAABCCCC",
      "ADDBBBCEE",
      "FFFGBHHII",
      "FFJGKKIII",
      "LLJMMNNOO",
      "PLLLQQROO",
      "PSSTTRRRO",
      "UUVVWWRXX",
      "UUUYYWXXX",
    ],
    sums: [
      30, 32, 25, 8, 5, 26, 11, 3, 30, 9, 8, 30, 11, 10, 27, 3, 9, 22, 12, 8, 30, 5, 20, 27, 5,
    ],
    givens: [
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
    ],
    solutions: [],
  },
  {
    name: "9x9 unique with givens",
    origin:
      "the 9x9 case with 2 to 4 solutions, with givens from its grid until one solution remains",
    geometry: GEOMETRY_9,
    cages: [
      "ABCCCDEFF",
      "ABCCGDEFF",
      "HBIIGJEKF",
      "HHLIIJMKK",
      "NLLIOOMPQ",
      "NLRROOSPQ",
      "NLTROUSVQ",
      "WTTRUUXVX",
      "WWTRUUXXX",
    ],
    sums: [
      10, 10, 29, 5, 10, 27, 9, 18, 24, 6, 20, 28, 9, 9, 32, 10, 14, 23, 13, 16, 27, 7, 24, 25,
    ],
    givens: [
      "43.......",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      "7........",
      ".........",
    ],
    solutions: [
      [
        "438972516",
        "651483279",
        "927615384",
        "276541893",
        "389267145",
        "514398762",
        "143829657",
        "765134928",
        "892756431",
      ],
    ],
  },
  {
    name: "9x9 without solution: a wrong given",
    origin: "the 9x9 unique case with givens, plus a given that differs from its solution",
    geometry: GEOMETRY_9,
    cages: [
      "ABCCCDEFF",
      "ABCCGDEFF",
      "HBIIGJEKF",
      "HHLIIJMKK",
      "NLLIOOMPQ",
      "NLRROOSPQ",
      "NLTROUSVQ",
      "WTTRUUXVX",
      "WWTRUUXXX",
    ],
    sums: [
      10, 10, 29, 5, 10, 27, 9, 18, 24, 6, 20, 28, 9, 9, 32, 10, 14, 23, 13, 16, 27, 7, 24, 25,
    ],
    givens: [
      "431......",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      ".........",
      "7........",
      ".........",
    ],
    solutions: [],
  },
];
