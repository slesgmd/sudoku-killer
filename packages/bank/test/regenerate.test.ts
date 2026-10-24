// T-20.4 (muestra): `regenerateSeed` da, para la primera semilla de cada dificultad del manifiesto,
// la misma dificultad y la misma calificación. El hash lo comprueban el servidor (`verifyEntry`) y
// el servidor simulado del cliente.
import { readFileSync } from "node:fs";
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { describe, expect, it } from "vitest";
import { assertCurrentManifest, manifestSchema, regenerateSeed } from "../src/index.ts";

const manifest = manifestSchema.parse(
  JSON.parse(
    readFileSync(new URL("../../../apps/server/bank/manifest.json", import.meta.url), "utf8"),
  ),
);

describe("T-20.4 regenerateSeed (sample)", () => {
  it("the manifest is current", () => {
    expect(() => {
      assertCurrentManifest(manifest);
    }).not.toThrow();
  });

  it.each(DIFFICULTIES)("the first %s seed gives its difficulty and grade", (difficulty) => {
    const entry = manifest.entries.find((e) => e.difficulty === difficulty);
    if (!entry) throw new Error(difficulty);
    const regenerated = regenerateSeed(entry.seed);
    expect(regenerated).toMatchObject({ seed: entry.seed, difficulty, accepted: true });
    expect(regenerated.result).toMatchObject({
      maxLevel: entry.graderMaxLevel,
      steps: entry.graderSteps,
    });
  });
});
