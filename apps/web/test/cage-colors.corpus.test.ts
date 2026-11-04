// Aleatorio sobre todo el banco (T-43.1): regenerar las 2 000 semillas es largo, así que no corre en
// cada push (`pnpm test:corpus`). La muestra de cada push está en cage-colors.test.ts.
import { readFileSync } from "node:fs";
import { manifestSchema, regenerateSeed } from "@sudoku-killer/bank";
import { describe, expect, it } from "vitest";
import { colorIssues, publicPuzzleOf } from "./helpers/cage-colors.ts";

const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(new URL("../../server/bank/manifest.json", import.meta.url), "utf8")),
);

describe("T-43.1 Aleatorio on the whole bank", () => {
  it(
    "every seed has colours for every cage, at most 6 and no equal neighbours",
    { timeout: 3_600_000 },
    () => {
      const begin = performance.now();
      const issues: string[] = [];
      for (const entry of manifest.entries) {
        const { generated } = regenerateSeed(entry.seed);
        const puzzle = publicPuzzleOf(generated.puzzle, `seed-${String(entry.seed)}`);
        for (const issue of colorIssues(puzzle)) issues.push(`${puzzle.id}: ${issue}`);
      }
      console.log(
        `cage colours: ${String(manifest.entries.length)} seeds in ${String(Math.round(performance.now() - begin))} ms`,
      );
      expect(manifest.entries.length).toBeGreaterThanOrEqual(2000);
      expect(issues).toEqual([]);
    },
  );
});
