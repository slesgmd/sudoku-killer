// Icono del sitio (R-45): lo enlaza index.html desde el propio origen, con sus tamaños reales, sin
// metadatos en los archivos y con el nombre y los colores del juego en el manifiesto.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { customHosts } from "./custom-hosts.ts";

const PUBLIC = new URL("../apps/web/public/", import.meta.url);
const INDEX = new URL("../apps/web/index.html", import.meta.url);
const TOKENS = new URL("../apps/web/src/styles/tokens.css", import.meta.url);

/** Lo que `index.html` debe enlazar, y nada más. */
const LINKS = [
  { rel: "icon", href: "/favicon.ico" },
  { rel: "icon", href: "/favicon-16x16.png" },
  { rel: "icon", href: "/favicon-32x32.png" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
];

const PNG_SIZES: Readonly<Record<string, number>> = {
  "favicon-16x16.png": 16,
  "favicon-32x32.png": 32,
  "apple-touch-icon.png": 180,
  "android-chrome-192x192.png": 192,
};

/** Los únicos bloques de PNG admitidos: una imagen, sin texto ni metadatos. */
const PNG_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "";

function iconLinks(html: string) {
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => ({ rel: attribute(tag, "rel"), href: attribute(tag, "href") }))
    .filter(({ rel }) => ["icon", "apple-touch-icon", "manifest"].includes(rel));
}

/** Lo que falla en los enlaces: cualquiera que no salga del propio origen. */
function externalLinks(links: readonly { readonly href: string }[]): string[] {
  return links.map(({ href }) => href).filter((href) => !/^\/(?!\/)/.test(href));
}

function pngOf(bytes: Buffer) {
  if (bytes.toString("latin1", 1, 4) !== "PNG") throw new Error("Not a PNG");
  const chunks: string[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    chunks.push(bytes.toString("latin1", at + 4, at + 8));
    at += 12 + length;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), chunks };
}

/** Lo que falla en un PNG: tamaño equivocado o bloques que no son de imagen. */
function pngIssues(bytes: Buffer, size: number): string[] {
  const { width, height, chunks } = pngOf(bytes);
  const issues = chunks.filter((chunk) => !PNG_CHUNKS.has(chunk)).map((chunk) => `chunk ${chunk}`);
  if (width !== size || height !== size) issues.push(`size ${String(width)}x${String(height)}`);
  return issues;
}

/** Un PNG mínimo con los bloques que se le pidan: basta para probar el detector. */
function fakePng(size: number, extra: readonly string[] = []): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(name, 4, "latin1");
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra.map((name) => chunk(name, Buffer.from("x"))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("T-45.1 the site icon", () => {
  const html = readFileSync(INDEX, "utf8");

  it("index.html links exactly its icons and its manifest, from the same origin", () => {
    expect(iconLinks(html)).toEqual(LINKS);
    expect(externalLinks(iconLinks(html))).toEqual([]);
    for (const { href } of LINKS) expect(existsSync(new URL(`.${href}`, PUBLIC)), href).toBe(true);
  });

  it("every PNG has its real size and carries only image data", () => {
    for (const [name, size] of Object.entries(PNG_SIZES))
      expect(pngIssues(readFileSync(new URL(name, PUBLIC)), size), name).toEqual([]);
  });

  it("favicon.ico has its three sizes, as plain bitmaps", () => {
    const ico = readFileSync(new URL("favicon.ico", PUBLIC));
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const entry = 6 + 16 * i;
      sizes.push(ico.readUInt8(entry));
      // 40 es la cabecera de un mapa de bits, sin bloques que puedan llevar texto.
      expect(ico.readUInt32LE(ico.readUInt32LE(entry + 12))).toBe(40);
    }
    expect(sizes).toEqual([16, 32, 48]);
  });

  it("no icon file carries a custom domain, nor the unused size", () => {
    for (const name of ["favicon.ico", ...Object.keys(PNG_SIZES), "site.webmanifest"])
      expect(customHosts(readFileSync(new URL(name, PUBLIC)).toString("latin1")), name).toEqual([]);
    expect(existsSync(new URL("android-chrome-512x512.png", PUBLIC))).toBe(false);
  });

  it("the manifest has the name and the colours of the game, and does not make it installable", () => {
    const canvas = /--canvas:\s*(#[0-9a-f]{6})/.exec(readFileSync(TOKENS, "utf8"))?.[1];
    expect(canvas).toBeDefined();
    expect(JSON.parse(readFileSync(new URL("site.webmanifest", PUBLIC), "utf8"))).toEqual({
      name: "Sudoku Killer",
      short_name: "Sudoku Killer",
      icons: [{ src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" }],
      theme_color: canvas,
      background_color: canvas,
      display: "browser",
    });
  });

  it("negative check: the detectors mark text in a PNG, a wrong size and an external link", () => {
    expect(pngIssues(fakePng(16), 16)).toEqual([]);
    for (const chunk of ["tEXt", "iTXt", "zTXt", "eXIf", "caBX"])
      expect(pngIssues(fakePng(16, [chunk]), 16)).toEqual([`chunk ${chunk}`]);
    expect(pngIssues(fakePng(32), 16)).toEqual(["size 32x32"]);
    expect(externalLinks([{ href: "https://elsewhere.example/favicon.ico" }])).toHaveLength(1);
    expect(externalLinks([{ href: "//elsewhere.example/favicon.ico" }])).toHaveLength(1);
    expect(externalLinks([{ href: "/favicon.ico" }])).toEqual([]);
  });
});
