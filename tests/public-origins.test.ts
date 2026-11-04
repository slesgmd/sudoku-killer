// El dominio propio de la web vive solo en el panel de Render y en el DNS (R-41): ningún archivo
// versionado lleva un host en punycode ni con letras fuera de ASCII. Los dominios `.example` son
// reservados y sirven de ejemplo en las pruebas y en los documentos.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { customHosts } from "./custom-hosts.ts";

const ROOT = new URL("../", import.meta.url);

describe("T-41.5 no custom domain in the public repository", () => {
  it("no tracked file carries one", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(100);
    const found: string[] = [];
    for (const file of files) {
      const content = readFileSync(new URL(file, ROOT));
      if (content.includes(0)) continue; // Binario.
      for (const host of customHosts(content.toString("utf8"))) found.push(`${file}: ${host}`);
    }
    expect(found).toEqual([]);
  });

  it("negative check: the detector flags both forms in any scheme, and nothing else", () => {
    // Se arman por partes para que este archivo no los lleve escritos.
    const punycode = ["xn--", "espaol-zwa", ".test"].join("");
    const unicode = ["espa", "ñol", ".test"].join("");
    expect(customHosts(`ALLOWED_ORIGINS=https://${punycode}`)).toEqual([punycode]);
    expect(customHosts(`domains: [${punycode}]`)).toEqual([punycode]);
    expect(customHosts(`https://${unicode}/#/sala/ABC`)).toEqual([unicode]);
    expect(customHosts(`wss://${unicode}/ws`)).toEqual([unicode]);
    for (const allowed of [
      "https://xn--espaol-zwa.example",
      "https://español.example",
      "https://…",
      "wss://…/ws",
      "https://sudoku-killer-lima.onrender.com",
      "https://es.wikipedia.org/wiki/Español",
      "el español",
    ])
      expect(customHosts(allowed), allowed).toEqual([]);
  });
});
