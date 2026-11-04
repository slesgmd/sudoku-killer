// Paleta de colores personales: lee tokens.css y comprueba contraste y distancia entre colores. La
// fórmula está escrita aquí, con las mismas constantes que la medición con la que se eligió la paleta.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (!match?.[1]) throw new Error(`No token ${name}`);
  return match[1];
}

type Rgb = readonly [number, number, number];
type Matrix = readonly [Rgb, Rgb, Rgb];

const hex = (color: string): Rgb => [
  parseInt(color.slice(1, 3), 16),
  parseInt(color.slice(3, 5), 16),
  parseInt(color.slice(5, 7), 16),
];

/** Linealización sRGB. */
function linear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Vuelta a sRGB, de 0 a 255, sin redondear a 8 bits. */
function encoded(value: number): number {
  const c = Math.max(0, Math.min(1, value));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
}

/** Relación de contraste WCAG. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r, g, bl] = hex(color);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(bl);
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** Machado 2009, severidad 1, sobre RGB lineal. */
const DEUTERANOPIA: Matrix = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];
const PROTANOPIA: Matrix = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
];

function simulated(rgb: Rgb, matrix: Matrix): Rgb {
  const [r, g, b] = [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
  const row = ([x, y, z]: Rgb) => encoded(x * r + y * g + z * b);
  return [row(matrix[0]), row(matrix[1]), row(matrix[2])];
}

/** sRGB a Lab, con la matriz a XYZ de D65 y su blanco. */
function lab(rgb: Rgb): Rgb {
  const [r, g, b] = [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000, con kL = kC = kH = 1. */
function deltaE00([L1, a1, b1]: Rgb, [L2, a2, b2]: Rgb): number {
  const rad = Math.PI / 180;
  const meanC = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const C1 = Math.hypot(ap1, b1);
  const C2 = Math.hypot(ap2, b2);
  const hue = (b: number, a: number) => {
    const degrees = Math.atan2(b, a) / rad;
    return degrees < 0 ? degrees + 360 : degrees;
  };
  const h1 = hue(b1, ap1);
  const h2 = hue(b2, ap2);
  const dL = L2 - L1;
  const dC = C2 - C1;
  let dh = 0;
  if (C1 * C2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2;
  const Cm = (C1 + C2) / 2;
  let hm = h1 + h2;
  if (C1 * C2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) hm /= 2;
    else hm = h1 + h2 < 360 ? (hm + 360) / 2 : (hm - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hm - 30) * rad) +
    0.24 * Math.cos(2 * hm * rad) +
    0.32 * Math.cos((3 * hm + 6) * rad) -
    0.2 * Math.cos((4 * hm - 63) * rad);
  const dT = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cm;
  const Sh = 1 + 0.015 * Cm * T;
  const Rt = -Math.sin(2 * dT * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

function distance(a: string, b: string, matrix?: Matrix): number {
  const of = (color: string) => lab(matrix ? simulated(hex(color), matrix) : hex(color));
  return deltaE00(of(a), of(b));
}

/** Los mínimos, sobre el valor sin redondear y sin tolerancia. */
const MIN_TEXT = 4.5;
const MIN_LINE = 3;
const MIN_DEUTERANOPIA = 10;
const MIN_NORMAL = 15;
const MIN_RESERVED = 12;
const MIN_PROTANOPIA = 5;

/** Las parejas de colores que incumplen una distancia mínima. */
function closePairs(colors: readonly string[], minimum: number, matrix?: Matrix): string[] {
  const issues: string[] = [];
  colors.forEach((a, i) => {
    for (const b of colors.slice(i + 1))
      if (distance(a, b, matrix) < minimum) issues.push(`${a}-${b}`);
  });
  return issues;
}

/** Los colores que no llegan al contraste mínimo con algún fondo. */
function lowContrast(
  colors: readonly string[],
  backgrounds: readonly string[],
  minimum: number,
): string[] {
  return colors.filter((color) => backgrounds.some((back) => contrast(color, back) < minimum));
}

const PALETTE = Array.from({ length: 9 }, (_, i) => token(`pal-${String(i + 1)}`));
const BACKGROUNDS = ["paper", "related-tint", "selection-tint", "danger-tint"].map(token);
const RESERVED = ["ink", "accent", "danger"].map(token);

/** Qué reglas incumple una paleta: T-42.3 las exige todas. */
function broken(colors: readonly string[]): string[] {
  const rules: string[] = [];
  if (closePairs(colors, MIN_DEUTERANOPIA, DEUTERANOPIA).length > 0) rules.push("deuteranopia");
  if (closePairs(colors, MIN_NORMAL).length > 0) rules.push("normal");
  if (closePairs(colors, MIN_PROTANOPIA, PROTANOPIA).length > 0) rules.push("protanopia");
  if (colors.some((c) => RESERVED.some((r) => distance(c, r) < MIN_RESERVED)))
    rules.push("reserved");
  return rules;
}

/** Los seis colores comunes a las dos variantes de la paleta. */
const COMMON = ["#B41955", "#A04B00", "#5F460F", "#00695A", "#2D5FB4", "#7D467D"];

describe("T-42.2 every colour of the palette is readable on the four cell backgrounds", () => {
  it("reads nine distinct colours from tokens.css", () => {
    expect(new Set(PALETTE.map((c) => c.toLowerCase())).size).toBe(9);
    expect(BACKGROUNDS).toHaveLength(4);
  });

  it("text reaches 4.5:1 and lines 3:1 on every background", () => {
    expect(lowContrast(PALETTE, BACKGROUNDS, MIN_TEXT)).toEqual([]);
    expect(lowContrast(PALETTE, BACKGROUNDS, MIN_LINE)).toEqual([]);
  });

  it("negative check: the detector marks a colour of 4.4:1", () => {
    const paper = token("paper");
    const color = "#747474";
    expect(contrast(color, paper)).toBeGreaterThanOrEqual(4.35);
    expect(contrast(color, paper)).toBeLessThan(4.45);
    expect(lowContrast([color], [paper], MIN_TEXT)).toEqual([color]);
  });
});

describe("T-42.3 the colours of the palette stay apart", () => {
  it("keeps the minimums, without rounding and without tolerance", () => {
    expect(closePairs(PALETTE, MIN_DEUTERANOPIA, DEUTERANOPIA)).toEqual([]);
    expect(closePairs(PALETTE, MIN_NORMAL)).toEqual([]);
    expect(closePairs(PALETTE, MIN_PROTANOPIA, PROTANOPIA)).toEqual([]);
    for (const color of PALETTE)
      for (const reserved of RESERVED)
        expect(distance(color, reserved)).toBeGreaterThanOrEqual(MIN_RESERVED);
  });

  // Los valores de la medición con la que se eligió la paleta. Si fallan, esta fórmula ya no es la
  // misma, aunque los mínimos sigan cumpliéndose.
  it.each([
    ["#2D5FB4", "#7D467D", DEUTERANOPIA, 11.9886],
    ["#06485D", "#3C3393", DEUTERANOPIA, 10.0141],
    ["#A04B00", "#5F460F", PROTANOPIA, 6.5384],
    ["#B41955", "#06485D", PROTANOPIA, 5.2787],
  ] as const)("%s and %s measure as they did when chosen", (a, b, matrix, expected) => {
    expect(Math.abs(distance(a, b, matrix) - expected)).toBeLessThanOrEqual(0.00005);
  });

  it("negative check: the formula measures a difference, also with other matrices", () => {
    expect(distance("#06485D", "#3C3393")).not.toBeCloseTo(10.0141, 1);
    expect(distance("#06485D", "#3C3393", PROTANOPIA)).not.toBeCloseTo(10.0141, 1);
  });

  it("negative check: the detector marks two nearly equal colours", () => {
    expect(closePairs(["#00695A", "#00695B"], MIN_DEUTERANOPIA, DEUTERANOPIA)).toHaveLength(1);
    expect(closePairs(["#00695A", "#00695B"], MIN_NORMAL)).toHaveLength(1);
    expect(closePairs(["#00695A", "#00695B"], MIN_PROTANOPIA, PROTANOPIA)).toHaveLength(1);
  });

  it("negative check: protanopia is a written rule that rejects the trio of 9.07:1", () => {
    expect(broken([...COMMON, "#214B51", "#3F3F75", "#54423C"])).toEqual(["protanopia"]);
  });

  it("negative check: the trio of 8.96:1 fails on normal vision and protanopia", () => {
    expect(broken([...COMMON, "#00512A", "#33427B", "#364854"])).toEqual(["normal", "protanopia"]);
  });

  it("control: both variants of the palette keep every rule", () => {
    expect(broken([...COMMON, "#0F3714", "#00286E", "#5F003C"])).toEqual([]);
    expect(broken([...COMMON, "#06485D", "#30482A", "#3C3393"])).toEqual([]);
  });
});
