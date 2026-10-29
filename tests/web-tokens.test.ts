// Los tokens de `tokens.css` son la única
// fuente de colores y tipografías del cliente, y las fuentes se sirven en local como woff2, con su
// licencia OFL.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(import.meta.dirname, "../apps/web");
const TOKENS = path.join(WEB, "src/styles/tokens.css");

function filesOf(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesOf(full) : [full];
  });
}

const RULES: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: "hex color", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { rule: "color function", pattern: /\b(rgba?|hsla?|oklch|lab|lch)\(/ },
  {
    rule: "font family",
    pattern: /font-family\s*:(?!\s*(?:var\(|inherit))|fontFamily\s*:(?!\s*"(?:var\(|inherit))/,
  },
];

/** Hallazgos de un texto, sin los comentarios de CSS ni las declaraciones `@font-face`. */
function tokenViolations(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@font-face\s*\{[^}]*\}/g, "");
  return RULES.filter(({ pattern }) => pattern.test(code)).map(({ rule }) => rule);
}

/** Declaraciones `--token: valor` de un CSS, normalizadas (Prettier cambia mayúsculas y saltos). */
function declarations(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
    ([, name, value]) =>
      `${name ?? ""}: ${(value ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`,
  );
}

describe("F8 checklist: tokens.css is the only source of colors and fonts", () => {
  it("the detector finds literal colors and font families (control)", () => {
    expect(tokenViolations(".x { color: #A6463D; }")).toEqual(["hex color"]);
    expect(tokenViolations(".x { background: rgba(0, 0, 0, 0.4); }")).toEqual(["color function"]);
    expect(tokenViolations(".x { font-family: Arial; }")).toEqual(["font family"]);
    expect(tokenViolations('<p style={{ fontFamily: "Arial" }} />')).toEqual(["font family"]);
    expect(tokenViolations(".x { color: var(--danger); font-family: var(--font-ui); }")).toEqual(
      [],
    );
    expect(tokenViolations('@font-face { font-family: "Inter"; }')).toEqual([]);
  });

  it("no CSS or component outside tokens.css has a literal color or font family", () => {
    const sources = filesOf(path.join(WEB, "src")).filter(
      (file) => /\.(css|tsx|ts)$/.test(file) && file !== TOKENS,
    );
    const findings = sources.flatMap((file) =>
      tokenViolations(readFileSync(file, "utf8")).map(
        (rule) => `${path.relative(WEB, file)}: ${rule}`,
      ),
    );
    expect(findings).toEqual([]);
  });

  it("tokens.css keeps the values of the F7 prototype, plus the tokens added in F8", () => {
    const prototype = path.resolve(import.meta.dirname, "../design/prototipo/tokens.css");
    // Agregados al implementar, tras la prueba en celular (docs/diseno.md §2.3).
    const added = ["--cage-width: 2px", "--cage-width-selected: 3px"];
    const current = declarations(TOKENS);
    expect(current.filter((d) => !added.includes(d))).toEqual(declarations(prototype));
    for (const token of added) expect(current).toContain(token);
  });

  it("Inter and Newsreader are local woff2 files with their OFL license, never inlined", () => {
    const fonts = path.join(WEB, "public/fonts");
    for (const file of [
      "inter-latin.woff2",
      "inter-latin-ext.woff2",
      "newsreader-latin.woff2",
      "newsreader-latin-ext.woff2",
      "OFL-Inter.txt",
      "OFL-Newsreader.txt",
    ]) {
      expect(existsSync(path.join(fonts, file)), file).toBe(true);
    }
    const css = readFileSync(path.join(WEB, "src/styles/fonts.css"), "utf8");
    expect(css).not.toMatch(/data:/);
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(urls).toHaveLength(4);
    for (const url of urls) expect(url).toMatch(/^\/fonts\/[a-z-]+\.woff2$/);
  });
});
