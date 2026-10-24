// T-31.3: `packages/protocol` no exporta ningún tipo con un campo `solution` (SPEC R-31).
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findForbiddenFields } from "./find-forbidden-fields.ts";

const FORBIDDEN = ["solution"];

/** Nombre de la exportación en la que empieza la ruta de un hallazgo. */
const exportOf = (hit: string): string | undefined => hit.split(/[.<([]/)[0];

/** Cada caso crea un programa de TypeScript: 1–2 s solo, más de 5 s con toda la suite en paralelo. */
const SLOW = { timeout: 60_000 };

describe("T-31.3 protocol exports never carry the solution", () => {
  it("the public entry point has no `solution` field in any exported type or value", SLOW, () => {
    const entry = path.resolve(import.meta.dirname, "../src/index.ts");
    expect(findForbiddenFields(entry, FORBIDDEN)).toEqual([]);
  });

  it(
    "the detector finds `solution` in interfaces, aliases, Zod schemas, unions and signatures",
    SLOW,
    () => {
      const fixture = path.resolve(import.meta.dirname, "fixtures/leaky.ts");
      const leakyExports = new Set(findForbiddenFields(fixture, FORBIDDEN).map(exportOf));
      expect([...leakyExports].sort()).toEqual([
        "LeakyAlias",
        "LeakyInferred",
        "LeakyState",
        "leakyFactory",
        "leakySchema",
        "leakyUnion",
      ]);
    },
  );
});
