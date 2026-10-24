// El hash del puzzle en el navegador (servidor simulado) es idéntico al de `node:crypto` (servidor,
// ADR 0006) y al del manifiesto, en una muestra de cada dificultad: con `crypto.subtle` y con el
// SHA-256 en JavaScript que se usa fuera de un contexto seguro (red local por `http://<IP>`).
import { createHash } from "node:crypto";
import { canonicalPuzzle, regenerateSeed } from "@sudoku-killer/bank";
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { puzzleHash, puzzleHashJs, puzzleHashSubtle } from "../src/dev/sim/hash.ts";
import { loadManifest } from "../src/dev/sim/puzzles.ts";
import { sha256Hex } from "../src/dev/sim/sha256.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("puzzle hash: crypto.subtle and the JS SHA-256 equal node:crypto (sample of the manifest)", () => {
  it.each(DIFFICULTIES)("the first two %s seeds", async (difficulty) => {
    const entries = (await loadManifest()).entries.filter((e) => e.difficulty === difficulty);
    for (const entry of entries.slice(0, 2)) {
      const canonical = canonicalPuzzle(regenerateSeed(entry.seed).generated);
      const node = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
      expect(await puzzleHashSubtle(canonical), `seed ${String(entry.seed)}`).toBe(node);
      expect(puzzleHashJs(canonical), `seed ${String(entry.seed)}`).toBe(node);
      expect(node, `seed ${String(entry.seed)}`).toBe(entry.hash);
    }
  });

  it("the JS SHA-256 equals node:crypto at every padding boundary and with UTF-8", () => {
    const inputs = [
      "",
      "abc",
      "ñandú · 9×9",
      ...[55, 56, 63, 64, 65, 119, 120, 1000].map((n) => "x".repeat(n)),
    ];
    for (const input of inputs) {
      const bytes = new TextEncoder().encode(input);
      expect(sha256Hex(bytes), `length ${String(bytes.length)}`).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    }
  });

  it("without crypto.subtle (not a secure context) it falls back to the JS SHA-256", async () => {
    const canonical = canonicalPuzzle(regenerateSeed(4).generated);
    const expected = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(await puzzleHash(canonical)).toBe(expected);
  });
});
