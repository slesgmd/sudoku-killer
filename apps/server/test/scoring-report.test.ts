// `scoring:report` (R-36 y `docs/puntuacion.md` §11): sobre el registro de una partida jugada
// contra el servidor real, el análisis cuenta exactamente los errores y sus señales, «probar hasta
// acertar», las pistas y la parte de los puntos que viene del cierre de unidades, y no cambia los
// parámetros.
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import { beforeAll, describe, expect, it } from "vitest";
import { analyze, RETRY_WINDOW_MS } from "../scripts/scoring-report/analyze.ts";
import { answer, emptyCells, started } from "./helpers/play.ts";
import { createTestServer, testBank, type TestServer } from "./helpers/server.ts";

beforeAll(async () => {
  await testBank();
}, 60_000);

/** Los dígitos que ya están bloqueados en la fila, la columna o la caja de la celda. */
function lockedPeers(h: TestServer, code: string, cell: number): Set<number> {
  const match = h.room(code).match;
  if (!match) throw new Error("No match");
  const row = Math.floor(cell / 9);
  const col = cell % 9;
  const digits = new Set<number>();
  match.state.cells.forEach((c, i) => {
    const r = Math.floor(i / 9);
    const k = i % 9;
    const box =
      Math.floor(r / 3) === Math.floor(row / 3) && Math.floor(k / 3) === Math.floor(col / 3);
    if (i !== cell && c.status === "locked" && (r === row || k === col || box)) digits.add(c.value);
  });
  return digits;
}

describe("F11h scoring:report", () => {
  it("R-36 counts mistakes, their signals, try-until-correct, hints and the closure share from a real log", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error("No players");
    const [first, second, third] = emptyCells(h, code).filter(
      (c) => lockedPeers(h, code, c).size > 0,
    );
    if (first === undefined || second === undefined || third === undefined)
      throw new Error("Not enough cells");

    // Ana falla en `first` con un dígito que no está a la vista y acierta enseguida (reintento).
    const quiet = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(
      (d) => d !== answer(h, code, first) && !lockedPeers(h, code, first).has(d),
    );
    if (quiet === undefined) throw new Error("No quiet digit");
    await h.advance(4_000);
    await ana.send("cell.place", { cell: first, digit: quiet });
    await h.advance(2_000);
    await ana.send("cell.place", { cell: first, digit: answer(h, code, first) });
    // Bea comete un error evidente en `second` (el dígito ya está en su fila, columna o caja) y lo
    // repite con otro dígito en la misma celda, pasada la ventana de reintento.
    const [visible] = [...lockedPeers(h, code, second)].filter(
      (d) => d !== answer(h, code, second),
    );
    if (visible === undefined) throw new Error("No visible digit");
    await h.advance(1_000);
    await bea.send("cell.place", { cell: second, digit: visible });
    await h.advance(RETRY_WINDOW_MS + 1_000);
    const other = [1, 2, 3, 4, 5, 6, 7, 8, 9].find(
      (d) => d !== answer(h, code, second) && d !== visible,
    );
    await bea.send("cell.place", { cell: second, digit: other ?? 1 });
    await h.advance(1_000);
    await bea.send("cell.place", { cell: second, digit: answer(h, code, second) });
    // Una pista de Bea.
    await bea.send("hint.use", { cell: third });
    await h.settle();

    const match = h.room(code).match;
    if (!match) throw new Error("No match");
    const report = analyze([
      {
        difficulty: "easy",
        puzzle: match.puzzle,
        events: await h.repository.events(match.state.id),
      },
    ]);
    expect(report.paramsVersion).toBe(PARAMS_V1.version);
    const easy = report.difficulties["easy"];
    expect(easy?.placements).toEqual({ solved: 2, mistakes: 3 });
    expect(easy?.mistakeSignals.evident).toBeGreaterThanOrEqual(1);
    expect(easy?.mistakeSignals.repeatedSameCell).toBe(1);
    // Los dos aciertos llegan a menos de 30 s de un error del mismo jugador en esa celda.
    expect(easy?.tryUntilCorrect.count).toBe(2);
    expect(easy?.hints.total).toBe(1);
    expect(easy?.mistakeSignals.gapSincePreviousActionMs.n).toBe(1);
    expect(easy?.matches).toBe(1);
    expect(easy?.playerScore.n).toBe(2);
    // Los puntajes del análisis son los del servidor en vivo.
    expect(easy?.teamScore.median).toBe(
      [...match.state.players.values()].reduce((sum, p) => sum + p.score, 0),
    );
  });
});
