// El hash del puzzle con `crypto.subtle` (servidor simulado, en el navegador) es idéntico al de
// `node:crypto` (servidor, ADR 0006) y al del manifiesto, en una muestra de cada dificultad.
import { createHash } from "node:crypto";
import { canonicalPuzzle, regenerateSeed } from "@sudoku-killer/bank";
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { describe, expect, it } from "vitest";
import { puzzleHashSubtle } from "../src/dev/sim/hash.ts";
import { loadManifest } from "../src/dev/sim/puzzles.ts";

describe("puzzle hash: crypto.subtle equals node:crypto (sample of the manifest)", () => {
  it.each(DIFFICULTIES)("the first two %s seeds", async (difficulty) => {
    const entries = (await loadManifest()).entries.filter((e) => e.difficulty === difficulty);
    for (const entry of entries.slice(0, 2)) {
      const canonical = canonicalPuzzle(regenerateSeed(entry.seed).generated);
      const node = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
      expect(await puzzleHashSubtle(canonical), `seed ${String(entry.seed)}`).toBe(node);
      expect(node, `seed ${String(entry.seed)}`).toBe(entry.hash);
    }
  });
});
