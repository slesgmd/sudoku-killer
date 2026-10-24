// Muestra imprimible del banco (F5d): 3 puzzles por dificultad en SVG, 2 por hoja A4, en un orden al
// azar y con letras, para que quien los resuelva no sepa la dificultad. Al final, la clave
// (dificultad, nivel y pasos de cada letra) y las soluciones. Sirve para la prueba manual en papel
// mientras no haya cliente (docs/dificultad.md).
//
//   pnpm --filter @sudoku-killer/server bank:sample [--seed 2026] [--per-difficulty 3] [--out ../../design/muestra-f5/muestra.html]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRng, type KillerPuzzle } from "@sudoku-killer/engine";
import { DIFFICULTIES, type Difficulty } from "@sudoku-killer/protocol";
import { manifestSchema, verifyEntry, type ManifestEntry } from "../src/puzzles/bank.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "2026" },
    "per-difficulty": { type: "string", default: "3" },
    out: {
      type: "string",
      default: fileURLToPath(new URL("../../../design/muestra-f5/muestra.html", import.meta.url)),
    },
  },
});
const perDifficulty = Number(values["per-difficulty"]);
const rng = createRng(Number(values.seed));

const NAMES: Record<Difficulty, string> = {
  easy: "Fácil",
  medium: "Media",
  hard: "Difícil",
  expert: "Experto",
};

const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(new URL("../bank/manifest.json", import.meta.url), "utf8")),
);

/** `count` entradas distintas de la dificultad, elegidas con el generador con semilla. */
function pick(difficulty: Difficulty, count: number): ManifestEntry[] {
  const pool = manifest.entries.filter((entry) => entry.difficulty === difficulty);
  const chosen: ManifestEntry[] = [];
  while (chosen.length < count && pool.length > 0) {
    const [entry] = pool.splice(rng.int(pool.length), 1);
    if (entry) chosen.push(entry);
  }
  return chosen.sort((a, b) => a.seed - b.seed);
}

const items = DIFFICULTIES.flatMap((difficulty) => pick(difficulty, perDifficulty)).map(
  (entry) => ({ entry, ...verifyEntry(entry).generated }),
);
for (let i = items.length - 1; i > 0; i--) {
  const j = rng.int(i + 1);
  const a = items[i];
  const b = items[j];
  if (a && b) [items[i], items[j]] = [b, a];
}
const letter = (index: number): string => String.fromCharCode(65 + index);

/** Tablero en SVG: cuadrícula, cajas, jaulas punteadas con su suma y números iniciales. */
function boardSvg(puzzle: KillerPuzzle, cell: number, digits?: readonly number[]): string {
  const { size, boxRows, boxCols } = puzzle;
  const pad = 2;
  const full = size * cell;
  const inset = Math.max(2, cell * 0.09);
  const cageOf = new Array<number>(size * size).fill(-1);
  puzzle.cages.forEach((cage, index) => {
    for (const c of cage.cells) cageOf[c] = index;
  });
  const same = (a: number, r: number, c: number): boolean =>
    r >= 0 && r < size && c >= 0 && c < size && cageOf[r * size + c] === cageOf[a];

  const parts: string[] = [];
  if (!digits) {
    // Jaulas: cada lado de celda que separa jaulas se dibuja hacia dentro. En cada extremo, el trazo
    // se acorta si el lado perpendicular también separa jaulas, y se alarga en una esquina cóncava.
    const segments: string[] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const i = r * size + c;
        const x0 = pad + c * cell;
        const y0 = pad + r * cell;
        const end = (dr: number, dc: number, ar: number, ac: number): number =>
          !same(i, r + ar, c + ac) ? inset : same(i, r + ar + dr, c + ac + dc) ? -inset : 0;
        // [lado: fila y columna vecinas]
        if (!same(i, r - 1, c)) {
          const y = y0 + inset;
          segments.push(
            `M${String(x0 + end(-1, 0, 0, -1))} ${String(y)}H${String(x0 + cell - end(-1, 0, 0, 1))}`,
          );
        }
        if (!same(i, r + 1, c)) {
          const y = y0 + cell - inset;
          segments.push(
            `M${String(x0 + end(1, 0, 0, -1))} ${String(y)}H${String(x0 + cell - end(1, 0, 0, 1))}`,
          );
        }
        if (!same(i, r, c - 1)) {
          const x = x0 + inset;
          segments.push(
            `M${String(x)} ${String(y0 + end(0, -1, -1, 0))}V${String(y0 + cell - end(0, -1, 1, 0))}`,
          );
        }
        if (!same(i, r, c + 1)) {
          const x = x0 + cell - inset;
          segments.push(
            `M${String(x)} ${String(y0 + end(0, 1, -1, 0))}V${String(y0 + cell - end(0, 1, 1, 0))}`,
          );
        }
      }
    }
    parts.push(`<path class="cage" d="${segments.join("")}"/>`);
    for (const cage of puzzle.cages) {
      const first = Math.min(...cage.cells);
      const x = pad + (first % size) * cell + inset - 1;
      const y = pad + Math.floor(first / size) * cell + inset - 1;
      const label = String(cage.sum);
      const w = label.length * cell * 0.17 + 3;
      parts.push(
        `<rect class="sum-bg" x="${String(x)}" y="${String(y)}" width="${w.toFixed(1)}" height="${(cell * 0.26).toFixed(1)}"/>`,
        `<text class="sum" x="${String(x + 1.5)}" y="${(y + cell * 0.22).toFixed(1)}" font-size="${(cell * 0.24).toFixed(1)}">${label}</text>`,
      );
    }
  }
  const lines: string[] = [];
  for (let k = 0; k <= size; k++) {
    const thick = k % boxCols === 0 ? "box" : "cell";
    lines.push(
      `<line class="${thick}" x1="${String(pad + k * cell)}" y1="${String(pad)}" x2="${String(pad + k * cell)}" y2="${String(pad + full)}"/>`,
    );
    const thickRow = k % boxRows === 0 ? "box" : "cell";
    lines.push(
      `<line class="${thickRow}" x1="${String(pad)}" y1="${String(pad + k * cell)}" x2="${String(pad + full)}" y2="${String(pad + k * cell)}"/>`,
    );
  }
  parts.push(...lines);
  const shown =
    digits ??
    puzzle.givens.reduce<number[]>(
      (all, { cell: c, value }) => {
        all[c] = value;
        return all;
      },
      new Array<number>(size * size).fill(0),
    );
  shown.forEach((digit, i) => {
    if (!digit) return;
    const x = pad + (i % size) * cell + cell / 2;
    const y = pad + Math.floor(i / size) * cell + cell * 0.68;
    parts.push(
      `<text class="digit" x="${String(x)}" y="${y.toFixed(1)}" font-size="${(cell * 0.5).toFixed(1)}">${String(digit)}</text>`,
    );
  });
  const box = full + 2 * pad;
  return `<svg viewBox="0 0 ${String(box)} ${String(box)}" width="${String(box)}" height="${String(box)}" role="img">${parts.join("")}</svg>`;
}

const puzzlesHtml = items
  .map(
    ({ puzzle }, index) => `
  <section class="puzzle">
    <h2>Puzzle ${letter(index)}</h2>
    ${boardSvg(puzzle, 52)}
    <p class="log">Inicio ______ &nbsp; Fin ______ &nbsp; ¿Terminado? sí / no &nbsp; Dificultad percibida (1 a 5) ____</p>
  </section>`,
  )
  .join("");

const keyRows = items
  .map(
    ({ entry, givensReason }, index) =>
      `<tr><td>${letter(index)}</td><td>${NAMES[entry.difficulty]}</td><td>${String(entry.graderMaxLevel)}</td><td>${String(entry.graderSteps)}</td><td>${String(entry.seed)}</td><td>${givensReason}</td></tr>`,
  )
  .join("");

const solutions = items
  .map(
    ({ puzzle, solution }, index) =>
      `<figure><figcaption>${letter(index)}</figcaption>${boardSvg(puzzle, 18, solution)}</figure>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Muestra imprimible F5</title>
<style>
  @page { size: A4; margin: 14mm; }
  :root { color-scheme: light; --ink: #1b1b1b; --soft: #6b6b6b; --line: #9a9a9a; }
  body { margin: 0; background: #fff; color: var(--ink); font: 14px/1.45 system-ui, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 16px; margin: 0 0 6px; }
  .intro { break-after: page; }
  .puzzle { break-inside: avoid; margin: 0 0 28px; }
  .puzzle:nth-of-type(2n) { break-after: page; }
  .puzzle svg { display: block; max-width: 100%; height: auto; }
  .log { color: var(--soft); font-size: 12px; margin: 6px 0 0; }
  .cell { stroke: var(--line); stroke-width: 0.8; }
  .box { stroke: var(--ink); stroke-width: 2.2; }
  .cage { fill: none; stroke: var(--ink); stroke-width: 1; stroke-dasharray: 3 2.5; }
  .sum-bg { fill: #fff; }
  .sum { fill: var(--ink); font-family: system-ui, sans-serif; font-weight: 600; }
  .digit { fill: var(--ink); text-anchor: middle; font-family: system-ui, sans-serif; }
  table { border-collapse: collapse; margin: 8px 0 16px; }
  td, th { border: 1px solid var(--line); padding: 3px 8px; text-align: left; }
  .key { break-before: page; }
  .solutions { display: flex; flex-wrap: wrap; gap: 12px; }
  figure { margin: 0; }
  figcaption { font-weight: 600; }
</style>
</head>
<body>
<main>
  <section class="intro">
    <h1>Muestra del banco de puzzles (F5)</h1>
    <p>${String(items.length)} puzzles killer de 9 × 9, ${String(perDifficulty)} por dificultad, en un orden al azar. La dificultad de cada letra está en la clave del final: conviene no mirarla hasta terminar.</p>
    <p>Reglas: cada fila, columna y caja de 3 × 3 tiene los dígitos del 1 al 9; las celdas de una jaula punteada suman el número de su esquina y no repiten dígitos.</p>
    <p>Para cada puzzle, anote la hora de inicio y de fin, si lo terminó y la dificultad percibida, de 1 (muy fácil) a 5 (muy difícil). Los resultados van a la tabla de la prueba manual de <code>docs/dificultad.md</code>.</p>
    <p class="log">Generado con <code>pnpm --filter @sudoku-killer/server bank:sample --seed ${values.seed}</code> desde el manifiesto (generador ${manifest.generatorVersion}, calificador ${manifest.graderVersion}, equivalencia ${manifest.mappingVersion}).</p>
  </section>
  ${puzzlesHtml}
  <section class="key">
    <h2>Clave</h2>
    <table><thead><tr><th>Puzzle</th><th>Dificultad</th><th>Nivel máximo</th><th>Pasos</th><th>Semilla</th><th>Números iniciales</th></tr></thead><tbody>${keyRows}</tbody></table>
    <h2>Soluciones</h2>
    <div class="solutions">${solutions}</div>
  </section>
</main>
</body>
</html>
`;

mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, html);
console.log(`Muestra: ${values.out} (${String(items.length)} puzzles)`);
