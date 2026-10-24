// Manifiesto del banco (F5, ADR 0006). T-20.3: ningún puzzle excede las técnicas y ningún fácil usa
// nivel 4 o más; cada dificultad tiene sus 500. T-20.4 (muestra): cada semilla regenera el mismo
// puzzle. T-20.5 (muestra): en partidas simuladas, `levelToDeduce` nunca devuelve `UNRATED`. El
// banco completo se verifica en `bank.corpus.test.ts`.
import { readFileSync } from "node:fs";
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PER_DIFFICULTY,
  assertCurrentManifest,
  buildBank,
  manifestSchema,
  serializeManifest,
  verifyEntry,
} from "../src/puzzles/bank.ts";
import { expectGameNeverUnrated, readManifest, sampleOf } from "./helpers/bank.ts";

const SLOW = { timeout: 120_000 };
const manifest = readManifest();

describe("T-20.3 bank manifest", () => {
  it("matches the current generator, grader and mapping", () => {
    expect(() => {
      assertCurrentManifest(manifest);
    }).not.toThrow();
    expect(() => {
      assertCurrentManifest({ ...manifest, graderVersion: "1" });
    }).toThrow(/generate a new manifest/);
  });

  it(`has ${String(DEFAULT_PER_DIFFICULTY)} puzzles per difficulty, in seed order`, () => {
    expect(manifest.perDifficulty).toBe(DEFAULT_PER_DIFFICULTY);
    for (const difficulty of DIFFICULTIES) {
      expect(manifest.entries.filter((e) => e.difficulty === difficulty)).toHaveLength(
        DEFAULT_PER_DIFFICULTY,
      );
    }
    const seeds = manifest.entries.map(({ seed }) => seed);
    expect(seeds.every((seed, i) => i === 0 || seed > (seeds[i - 1] ?? 0))).toBe(true);
    expect(seeds[0]).toBeGreaterThanOrEqual(manifest.baseSeed);
  });

  it("levels fit the difficulty: no easy puzzle needs level 4 or more, none exceeds", () => {
    const allowed = { easy: [1, 2], medium: [3], hard: [3, 4], expert: [5] } as const;
    for (const { seed, difficulty, graderMaxLevel } of manifest.entries) {
      expect(allowed[difficulty], `seed ${String(seed)}`).toContain(graderMaxLevel);
    }
  });

  it("the file is what serializeManifest writes, one entry per line", () => {
    const text = readFileSync(new URL("../bank/manifest.json", import.meta.url), "utf8");
    expect(text.replace(/\r\n/g, "\n")).toBe(serializeManifest(manifest));
    expect(manifestSchema.parse(JSON.parse(serializeManifest(manifest)))).toEqual(manifest);
  });

  it("buildBank is deterministic and picks the same first seeds as the manifest", SLOW, () => {
    const options = { baseSeed: manifest.baseSeed, perDifficulty: 3 };
    const first = buildBank(options).manifest;
    expect(buildBank(options).manifest).toEqual(first);
    expect(first.entries).toEqual(sampleOf(manifest, 3).entries);
  });
});

describe("T-20.4 bank entries regenerate the same puzzle (sample)", () => {
  it("each sampled seed gives the same hash, grade and difficulty", SLOW, () => {
    for (const entry of sampleOf(manifest, 3).entries) verifyEntry(entry);
  });

  it("a changed entry is rejected with its seed", () => {
    const [entry] = manifest.entries;
    if (!entry) throw new Error("Empty manifest");
    expect(() => verifyEntry({ ...entry, hash: "0000000000000000" })).toThrow(
      new RegExp(`seed ${String(entry.seed)}`),
    );
    expect(() => verifyEntry({ ...entry, graderSteps: entry.graderSteps + 1 })).toThrow();
  });
});

describe("T-20.5 levelToDeduce is never UNRATED on bank puzzles (sample)", () => {
  it(
    "in simulated games, every empty cell gets a level from 1 to the puzzle's maximum",
    SLOW,
    () => {
      let calls = 0;
      for (const entry of sampleOf(manifest, 3).entries) {
        const { generated } = verifyEntry(entry);
        calls += expectGameNeverUnrated(generated, entry.graderMaxLevel, entry.seed);
      }
      expect(calls).toBeGreaterThan(0);
    },
  );
});
