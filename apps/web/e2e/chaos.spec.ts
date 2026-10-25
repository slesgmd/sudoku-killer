// Caos (F11c, SPEC §8.1): una partida de tres personas con cortes de conexión reales en momentos que
// salen de una semilla. Cada corte cierra el socket de verdad (nunca el modo sin conexión de
// Chromium, que no cierra los WebSocket abiertos), y la prueba comprueba en el registro que el
// servidor anotó cada desconexión:
// - el servidor cierra la conexión (E-01);
// - la página cierra su WebSocket (E-01);
// - la página se cierra y se abre otra en el mismo contexto, con la ficha (E-01);
// - la conexión se cierra justo después de entregar una jugada, antes de su respuesta (E-07);
// - la conexión declara más bytes encolados que los límites: primero no recibe la presencia y
//   después el servidor la cierra con 1013 (E-17).
// Al final, cada página muestra lo mismo que el servidor (celdas, vidas y notas), cada jugada quedó
// una sola vez en el registro y nadie recibió una penalización de más.
//
// En cada push corren la semilla fija y las regresiones. `SK_CHAOS_SEED` corre otra (el workflow
// semanal `chaos.yml`), y toda semilla que falle se agrega a `REGRESSIONS`. Cada fallo imprime su
// semilla. Verificación negativa: con `SK_CHAOS_BREAK=1`, los reenvíos llegan con otro `id` y la
// prueba tiene que fallar por una penalización duplicada.
import type { BrowserContext, Page } from "@playwright/test";
import { digitsOf } from "@sudoku-killer/engine/model";
import type { ServerEnvelope } from "@sudoku-killer/protocol";
import { cell, createRoom, expect, joinRoom, record, test, type GameServer } from "./fixtures.ts";
import { at, matchOf, place, start, wrongDigit } from "./game.ts";

const FIXED_SEED = 20261025;
/** Semillas que fallaron alguna vez (cada una con su fecha y su causa en la BITÁCORA). */
const REGRESSIONS: readonly number[] = [];
const STEPS = 18;

const fromEnv = process.env["SK_CHAOS_SEED"];
const SEEDS = fromEnv ? [Number(fromEnv)] : [FIXED_SEED, ...REGRESSIONS];
const BREAK = process.env["SK_CHAOS_BREAK"] === "1";

type Cut = "server" | "page-socket" | "page-close" | "in-flight" | "slow";
const CUTS: readonly Cut[] = ["server", "page-socket", "page-close", "in-flight", "slow"];
type Action = "correct" | "wrong" | "personal" | "group";

/** mulberry32: el azar de la prueba sale solo de la semilla. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Person {
  readonly name: string;
  readonly context: BrowserContext;
  page: Page;
  seen: ServerEnvelope[];
  corrects: number;
  wrongs: number;
}

/** Guarda los WebSocket que abre la página, para cerrar el último desde la página. */
const TRACK_SOCKETS = () => {
  const Native = window.WebSocket;
  const sockets: WebSocket[] = [];
  (window as unknown as { __skSockets: WebSocket[] }).__skSockets = sockets;
  window.WebSocket = class extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      sockets.push(this);
    }
  };
};

const welcomes = (seen: readonly ServerEnvelope[]) =>
  seen.filter((m) => m.type === "room.welcome").length;

for (const seed of SEEDS) {
  test(`E-01 E-07 E-17 chaos seed=${String(seed)}: real cuts lose no state and never penalize twice`, async ({
    browser,
    game,
    player,
  }) => {
    try {
      await chaos(seed, game, browser, player);
    } catch (error) {
      if (error instanceof Error)
        error.message = `[SK_CHAOS_SEED=${String(seed)}] ${error.message}`;
      throw error;
    }
  });
}

async function chaos(
  seed: number,
  game: GameServer,
  browser: import("@playwright/test").Browser,
  player: (options?: { context?: BrowserContext }) => Promise<Page>,
): Promise<void> {
  const random = rng(seed);
  const pick = <T>(items: readonly T[]): T => at(items, Math.floor(random() * items.length));
  game.breakResend(BREAK);

  const people: Person[] = [];
  let code = "";
  for (const name of ["Ana", "Beto", "Caro"]) {
    const context = await browser.newContext();
    await context.addInitScript(TRACK_SOCKETS);
    const page = await player({ context });
    const seen = record(page);
    if (people.length === 0) code = await createRoom(page, name);
    else await joinRoom(page, code, name);
    people.push({ name, context, page, seen, corrects: 0, wrongs: 0 });
  }
  try {
    await start(
      at(people, 0).page,
      people.map((p) => p.page),
    );
    const solution = matchOf(game, code).solution;
    const matchId = matchOf(game, code).state.id;
    const state = () => matchOf(game, code).state;
    const idOf = (person: Person) => {
      const found = [...state().players.values()].find((p) => p.nickname === person.name);
      if (!found) throw new Error(`No ${person.name}`);
      return found;
    };
    const taken = new Set<number>();
    const freeCell = () =>
      pick(state().cells.flatMap((c, i) => (c.status === "empty" && !taken.has(i) ? [i] : [])));
    const disconnections = async (person: Person) =>
      (await game.events(matchId)).filter(
        (e) =>
          e.type === "player.connection" &&
          e.payload.playerId === idOf(person).id &&
          e.payload.connection === "disconnected",
      ).length;

    /** Espera a que el servidor anote el corte y a que la página vuelva con un snapshot nuevo. */
    const recovered = async (person: Person, before: number, welcomed: number) => {
      await expect
        .poll(() => disconnections(person), { message: `${person.name}: disconnection logged` })
        .toBe(before + 1);
      await expect
        .poll(() => welcomes(person.seen), { message: `${person.name}: back with a snapshot` })
        .toBeGreaterThan(welcomed);
      await expect.poll(() => idOf(person).connection).toBe("connected");
    };

    const act = async (person: Person, action: Action) => {
      const { page } = person;
      const me = idOf(person);
      if (action === "correct") {
        const target = freeCell();
        taken.add(target);
        await place(page, target, solution[target] ?? 0);
        person.corrects++;
        await expect
          .poll(() => state().cells[target])
          .toMatchObject({ status: "locked", by: me.id });
      } else if (action === "wrong") {
        const target = freeCell();
        taken.add(target);
        await place(page, target, wrongDigit(solution, target));
        person.wrongs++;
        await expect.poll(() => idOf(person).mistakes).toBe(person.wrongs);
      } else {
        const target = freeCell();
        const digit = 1 + Math.floor(random() * 9);
        const group = action === "group";
        const notes = () =>
          digitsOf((group ? state().groupNotes : idOf(person).personalNotes)[target] ?? 0);
        // Un toque sobre una nota que ya estaba la quita: se espera el estado que corresponde.
        const had = notes().includes(digit);
        await cell(page, target).click();
        await page.keyboard.press("n");
        if (group) await page.getByRole("button", { name: "Grupal", exact: true }).click();
        await page.keyboard.press(String(digit));
        if (group) await page.getByRole("button", { name: "Personal", exact: true }).click();
        await page.keyboard.press("n");
        await expect.poll(() => notes().includes(digit)).toBe(!had);
      }
    };

    // Los pasos, para reproducir un fallo con su semilla (en las anotaciones del informe).
    const log: string[] = [];
    test.info().annotations.push({ type: "chaos", description: `seed ${String(seed)}` });
    for (let step = 0; step < STEPS; step++) {
      const person = pick(people);
      const others = people.filter((p) => p !== person);
      let action: Action = pick(["correct", "correct", "wrong", "personal", "group"] as const);
      if (action === "wrong" && person.wrongs >= 2) action = "correct";
      const cut = random() < 0.5 ? pick(CUTS) : null;
      // En el corte E-07, una jugada; con un error (mientras le queden vidas para eso), un reenvío
      // mal hecho penalizaría dos veces.
      if (cut === "in-flight") action = person.wrongs < 2 ? "wrong" : "correct";
      log.push(`${person.name}:${action}${cut ? `/${cut}` : ""}`);
      if (cut === null) {
        await act(person, action);
        continue;
      }
      const before = await disconnections(person);
      const welcomed = welcomes(person.seen);
      const link = game.linkOf(person.name);
      if (!link) throw new Error(`${person.name} has no connection`);
      if (cut === "server") {
        link.close(1011, "chaos");
        await recovered(person, before, welcomed);
        await act(person, action);
      } else if (cut === "page-socket") {
        await person.page.evaluate(() => {
          (window as unknown as { __skSockets: WebSocket[] }).__skSockets.at(-1)?.close();
        });
        await recovered(person, before, welcomed);
        await act(person, action);
      } else if (cut === "page-close") {
        await person.page.close();
        const page = await player({ context: person.context });
        person.seen = record(page);
        person.page = page;
        await page.goto(`/#/sala/${code}`);
        await recovered(person, before, 0);
        await expect(page.getByRole("grid", { name: "Tablero" })).toBeVisible();
        await act(person, action);
      } else if (cut === "in-flight") {
        // E-07: la jugada llega y se aplica, pero su respuesta no: el cliente la reenvía.
        link.dropAfter = new Set(["cell.place"]);
        await act(person, action);
        await recovered(person, before, welcomed);
      } else {
        // E-17: con más de 256 KiB encolados no recibe la presencia; con más de 1 MiB, 1013.
        const other = pick(others);
        link.extraBuffered = 300 * 1024;
        const presence = (seen: readonly ServerEnvelope[]) =>
          seen.filter((m) => m.type === "presence.updated" && m.payload.playerId === idOf(other).id)
            .length;
        const [mine, third] = [
          presence(person.seen),
          presence(
            at(
              others.filter((p) => p !== other),
              0,
            ).seen,
          ),
        ];
        await cell(other.page, freeCell()).click();
        await expect
          .poll(() =>
            presence(
              at(
                others.filter((p) => p !== other),
                0,
              ).seen,
            ),
          )
          .toBeGreaterThan(third);
        expect(presence(person.seen), `${person.name} still got presence while saturated`).toBe(
          mine,
        );
        link.extraBuffered = 2 * 1024 * 1024;
        await act(other, "personal");
        await recovered(person, before, welcomed);
        await act(person, action);
      }
    }

    test.info().annotations.push({ type: "steps", description: log.join(" ") });
    if (process.env["SK_CHAOS_VERBOSE"] === "1")
      console.log(`chaos seed=${String(seed)}: ${log.join(" ")}`);

    // Todos conectados y sin nada pendiente: cada página muestra lo mismo que el servidor.
    for (const person of people) await expect.poll(() => idOf(person).connection).toBe("connected");
    // El registro, una vez confirmado todo lo aplicado (el estado en memoria va antes que el group
    // commit).
    await expect
      .poll(async () => (await game.events(matchId)).at(-1)?.seq, { message: "log confirmed" })
      .toBe(state().seq);
    const events = await game.events(matchId);
    for (const person of people) {
      const me = idOf(person);
      const mine = (type: string) =>
        events.filter(
          (e) => e.type === type && "playerId" in e.payload && e.payload.playerId === me.id,
        );
      // Una sola vez cada jugada, y ninguna penalización de más (E-07).
      expect(mine("cell.mistake"), `${person.name}: mistakes in the log`).toHaveLength(
        person.wrongs,
      );
      expect(mine("cell.solved"), `${person.name}: hits in the log`).toHaveLength(person.corrects);
      expect([me.lives, me.mistakes], `${person.name}: lives and mistakes`).toEqual([
        3 - person.wrongs,
        person.wrongs,
      ]);
      await expect
        .poll(() => cellsOf(person.page), {
          message: `${person.name}: the board matches the server`,
        })
        .toEqual(expectedCells(game, code, me.id));
      for (const shown of people)
        await expect(
          shown.page
            .getByRole("region", { name: "Jugadores" })
            .getByRole("listitem")
            .filter({ hasText: person.name }),
          `${shown.name} sees the lives of ${person.name}`,
        ).toContainText(new RegExp(`${String(me.lives)} vidas? de 3`));
    }
    const ids = events.flatMap((e) => ("clientMsgId" in e.payload ? [e.payload.clientMsgId] : []));
    expect(new Set(ids).size, "a command applied twice").toBe(ids.length);
  } finally {
    for (const person of people) await person.context.close();
  }
}

interface CellView {
  readonly solved: boolean;
  readonly personal: string;
  readonly group: string;
}

/** Lo que la página muestra de cada celda, leído de su nombre accesible. */
async function cellsOf(page: Page): Promise<CellView[]> {
  const labels = await page
    .getByRole("grid", { name: "Tablero" })
    .locator("[data-cell]")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label") ?? ""));
  const digits = (label: string, layer: string) =>
    (new RegExp(`notas ${layer} ([\\d, y]+)`).exec(label)?.[1] ?? "").replace(/\D/g, "");
  return labels.map((label) => ({
    solved: !/(^|, )vacía/.test(label.split(", jaula")[1] ?? label),
    personal: digits(label, "personales"),
    group: digits(label, "grupales"),
  }));
}

function expectedCells(game: GameServer, code: string, playerId: string): CellView[] {
  const state = matchOf(game, code).state;
  const me = state.players.get(playerId);
  return state.cells.map((c, i) => {
    const solved = c.status === "locked";
    return {
      solved,
      personal: solved ? "" : digitsOf(me?.personalNotes[i] ?? 0).join(""),
      group: solved ? "" : digitsOf(state.groupNotes[i] ?? 0).join(""),
    };
  });
}
