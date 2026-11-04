// Ayudas de las pruebas de Aleatorio: el puzzle público de una semilla y el detector de lo que T-43.1
// no admite.
import type { PublicPuzzle } from "@sudoku-killer/protocol";
import { cageColors, cageNeighbours } from "../../src/game/cage-colors.ts";

interface GeneratedShape {
  readonly size: number;
  readonly boxRows: number;
  readonly boxCols: number;
  readonly cages: readonly {
    readonly id: number;
    readonly cells: readonly number[];
    readonly sum: number;
  }[];
}

/** El puzzle público de una semilla: `cageColors` solo usa su `id` y su geometría. */
export function publicPuzzleOf(puzzle: GeneratedShape, id: string): PublicPuzzle {
  return {
    id,
    size: puzzle.size,
    boxRows: puzzle.boxRows,
    boxCols: puzzle.boxCols,
    difficulty: "easy",
    cages: puzzle.cages.map(({ id: cageId, cells, sum }) => ({
      id: cageId,
      cells: [...cells],
      sum,
    })),
    givens: [],
  };
}

/** Lo que falla en unos colores: faltan, sobran o hay vecinas iguales. */
export function colorIssues(
  puzzle: PublicPuzzle,
  colors: readonly number[] | null = cageColors(puzzle),
): string[] {
  if (colors === null) return ["ran out of colours"];
  const issues: string[] = [];
  puzzle.cages.forEach((_, cage) => {
    const color = colors[cage] ?? 0;
    if (color < 1 || color > 9) issues.push(`cage ${String(cage)} without a colour`);
  });
  cageNeighbours(puzzle).forEach((list, cage) => {
    for (const other of list)
      if (other > cage && colors[other] === colors[cage])
        issues.push(`equal neighbours ${String(cage)} and ${String(other)}`);
  });
  if (new Set(colors).size > 6) issues.push("more than 6 colours");
  return issues;
}
