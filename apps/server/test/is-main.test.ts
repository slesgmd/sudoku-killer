// Los scripts de `scripts/` solo corren su parte principal si son el punto de entrada. Regresión: con
// `file://${argv[1]}` no corrían en Windows (barras, letra de unidad) ni con espacios en la ruta.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isMain } from "../scripts/is-main.ts";

describe("isMain", () => {
  it("recognizes the entry script even when the path has spaces or non-ASCII characters", () => {
    const dir = mkdtempSync(join(tmpdir(), "sk ñ "));
    try {
      const script = join(dir, "script.ts");
      expect(isMain(pathToFileURL(script).href, script)).toBe(true);
      // the old comparison, kept to show what failed
      expect(pathToFileURL(script).href === `file://${script}`).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is false for another module or without an entry point", () => {
    const a = join(tmpdir(), "a.ts");
    expect(isMain(pathToFileURL(a).href, join(tmpdir(), "b.ts"))).toBe(false);
    expect(isMain(pathToFileURL(a).href, undefined)).toBe(false);
  });
});
