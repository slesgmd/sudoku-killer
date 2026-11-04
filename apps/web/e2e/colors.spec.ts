// E2E de los colores personales y la negrita contra el servidor real, en Chromium (SPEC, R-42 y R-44):
// - el color se ve en el tablero, no cambia para otro jugador y no sale ningún mensaje (T-42.6);
// - personal, grupal y ambas se distinguen también con el mismo color (T-42.7), y la raya no entra en
//   la nota de abajo (T-42.20);
// - los estados del tablero no dependen del color elegido (T-42.8);
// - el panel cabe a 360, 640 × 360 y 1280 px (T-42.9), y sus radios funcionan con el teclado (T-42.4);
// - las transiciones viven solo en Ajustes y respetan el movimiento reducido (T-42.19);
// - la negrita no mueve las notas (T-44.3) y usa el peso real de la fuente (T-44.4).
import { inflateSync } from "node:zlib";
import type { CDPSession, Page } from "@playwright/test";
import { digitBit } from "@sudoku-killer/engine/model";
import { cell, createRoom, expect, joinRoom, test, type GameServer } from "./fixtures.ts";
import { at, emptyCells, matchOf, place, playerOf, start, wrongDigit } from "./game.ts";

const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 360, height: 640 };
const LANDSCAPE = { width: 640, height: 360 };

const colorsJson = (colors: Partial<Record<string, number | boolean>>) =>
  JSON.stringify({ version: 1, random: false, cage: 0, sum: 0, personal: 0, group: 0, ...colors });

/** Deja guardados unos colores antes de cargar la página. */
async function storeColors(page: Page, colors: Partial<Record<string, number | boolean>>) {
  await page.addInitScript((json) => {
    localStorage.setItem("sk:pref:colors", json);
  }, colorsJson(colors));
}

/** Empieza una partida de una persona, con los colores que se le pidan. */
async function soloMatch(
  page: Page,
  game: GameServer,
  colors: Partial<Record<string, number | boolean>> = {},
) {
  await storeColors(page, colors);
  const code = await createRoom(page, "Inés");
  await start(page, [page]);
  return { code, empty: emptyCells(game, code), solution: matchOf(game, code).solution };
}

async function setMode(page: Page, mode: "Número" | "Notas") {
  await page.getByRole("button", { name: mode, exact: true }).click();
}

/** Escribe una nota con la capa que se pida, en modo Notas. */
async function writeNote(page: Page, index: number, digit: number, layer: "Personal" | "Grupal") {
  await page.getByRole("button", { name: layer, exact: true }).click();
  await cell(page, index).click();
  await page.keyboard.press(String(digit));
}

/** Espera a que la nota esté dibujada: `note` es el selector de su clase (`.n.p`, `.n.g`, `.n.gp`). */
function noteIn(page: Page, index: number, note: string, digit: number) {
  return page
    .locator(".sk-board[role=grid] [role=gridcell]")
    .nth(index)
    .locator(note, { hasText: String(digit) });
}

const openSettings = (page: Page) => page.getByRole("button", { name: "Ajustes" }).click();
const closeSettings = (page: Page) => page.keyboard.press("Escape");
const swatch = (page: Page, group: string, color: string) =>
  page.getByRole("group", { name: group, exact: true }).getByRole("radio", { name: color });

/** El color de un token, tal como lo calcula el navegador. */
function tokenColor(page: Page, name: string): Promise<string> {
  return page.evaluate((token) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--${token})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
}

test("T-42.6 a colour shows on the real board, does not change for another player and sends nothing", async ({
  player,
  game,
}) => {
  const host = await player();
  const sent: string[] = [];
  host.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      sent.push(String(payload));
    });
  });
  const code = await createRoom(host, "Inés");
  const guest = await player();
  await joinRoom(guest, code, "Tomás");
  await start(host, [host, guest]);
  const [first, second] = emptyCells(game, code);
  if (first === undefined || second === undefined) throw new Error("No empty cells");

  // Una nota grupal, que los dos ven.
  await setMode(host, "Notas");
  await writeNote(host, first, 1, "Grupal");
  await expect(noteIn(host, first, ".n.g", 1)).toBeVisible();
  await expect(noteIn(guest, first, ".n.g", 1)).toBeVisible();
  const ink = await tokenColor(host, "ink");
  await expect(noteIn(host, first, ".n.g", 1)).toHaveCSS("color", ink);

  await openSettings(host);
  const before = sent.length;
  await swatch(host, "Grupal", "Jade").check();
  await swatch(host, "Personal", "Azul").check();
  await swatch(host, "Jaula", "Frambuesa").check();
  await swatch(host, "Suma", "Cobre").check();
  await closeSettings(host);

  const pal = (n: number) => tokenColor(host, `pal-${String(n)}`);
  await expect(noteIn(host, first, ".n.g", 1)).toHaveCSS("color", await pal(5));
  await writeNote(host, second, 2, "Personal");
  await expect(noteIn(host, second, ".n.p", 2)).toHaveCSS("color", await pal(6));
  await expect(host.locator(".sk-board[role=grid] .cg").first()).toHaveCSS(
    "border-top-color",
    await pal(1),
  );
  await expect(host.locator(".sk-board[role=grid] .sum").first()).toHaveCSS("color", await pal(2));

  // Lo elegido no sale del navegador: la nota es lo único que se envió desde entonces.
  const types = sent
    .slice(before)
    .map((frame) => (JSON.parse(frame) as { type: string }).type)
    .filter((type) => type !== "sys.ping" && type !== "presence.select");
  expect(types).toEqual(["note.add"]);

  // El otro jugador sigue con sus colores.
  await expect(noteIn(guest, first, ".n.g", 1)).toHaveCSS("color", ink);
  const guestBoard = guest.locator(".sk-board[role=grid]");
  for (const attribute of ["data-cage", "data-sum", "data-note-personal", "data-note-group"])
    await expect(guestBoard).not.toHaveAttribute(attribute);

  // Lo elegido se conserva al recargar.
  await host.reload();
  await expect(noteIn(host, first, ".n.g", 1)).toHaveCSS("color", await pal(5));
});

async function underlineOf(page: Page, index: number, note: string, digit: number) {
  const target = noteIn(page, index, note, digit);
  await expect(target).toBeVisible();
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      weight: style.fontWeight,
      line: style.textDecorationLine,
      lineStyle: style.textDecorationStyle,
      lineColor: style.textDecorationColor,
      thickness: style.textDecorationThickness,
    };
  });
}

for (const same of [false, true]) {
  test(`T-42.7 personal, group and both stay apart with ${same ? "the same colour" : "different colours"}`, async ({
    player,
    game,
  }) => {
    const page = await player();
    const colors = same ? { personal: 5, group: 5 } : { personal: 6, group: 5 };
    const { code, empty, solution } = await soloMatch(page, game, colors);
    const [placed, personal, group, both] = empty;
    if (placed === undefined || personal === undefined || group === undefined || both === undefined)
      throw new Error("Not enough empty cells");
    const digit = solution[placed] ?? 0;
    await place(page, placed, digit);
    await expect(cell(page, placed)).toHaveAttribute("aria-label", /resuelta/);
    expect(matchOf(game, code).state.cells[placed]?.status).not.toBe("empty");

    await setMode(page, "Notas");
    await writeNote(page, personal, digit, "Personal");
    await writeNote(page, group, digit, "Grupal");
    await writeNote(page, both, digit, "Grupal");
    await writeNote(page, both, digit, "Personal");
    await cell(page, personal).click();

    const board = page.locator(".sk-board[role=grid]");
    if (same) await expect(board).toHaveAttribute("data-notes-same", "");
    else await expect(board).not.toHaveAttribute("data-notes-same");

    const personalColor = await tokenColor(page, `pal-${String(colors.personal)}`);
    const groupColor = await tokenColor(page, `pal-${String(colors.group)}`);

    const p = await underlineOf(page, personal, ".n.p", digit);
    const g = await underlineOf(page, group, ".n.g", digit);
    const gp = await underlineOf(page, both, ".n.gp", digit);

    expect(p).toMatchObject({ color: personalColor, weight: "400", line: "underline" });
    expect(p.lineColor).toBe(personalColor);
    expect(p).toMatchObject({ thickness: "1px", lineStyle: "solid" });
    expect(g).toMatchObject({ color: groupColor, weight: "600", line: "none" });
    expect(gp).toMatchObject({ color: groupColor, weight: "600", line: "underline" });
    expect(gp.lineColor).toBe(personalColor);
    expect(gp).toMatchObject({ thickness: "1px", lineStyle: same ? "dotted" : "solid" });

    // En negrita, los tres pasan a 800 y siguen distinguiéndose.
    await cell(page, placed).click();
    const strong = (note: string, index: number) =>
      underlineOf(page, index, `${note}.strong`, digit);
    const pS = await strong(".n.p", personal);
    const gS = await strong(".n.g", group);
    const gpS = await strong(".n.gp", both);
    expect([pS.weight, gS.weight, gpS.weight]).toEqual(["800", "800", "800"]);
    expect(gS.line).toBe("none");
    expect(pS.line).toBe("underline");
    expect(gpS.line).toBe("underline");
    if (same) {
      expect(pS.color).toBe(gpS.color);
      expect([pS.lineStyle, gpS.lineStyle]).toEqual(["solid", "dotted"]);
    } else {
      expect(pS.color).not.toBe(gpS.color);
      expect([pS.lineStyle, gpS.lineStyle]).toEqual(["solid", "solid"]);
    }
  });
}

test("T-42.7 Predeterminado keeps its look", async ({ player, game }) => {
  const page = await player();
  const { empty } = await soloMatch(page, game);
  const [personal, both] = empty;
  if (personal === undefined || both === undefined) throw new Error("Not enough empty cells");
  await setMode(page, "Notas");
  await writeNote(page, personal, 3, "Personal");
  await writeNote(page, both, 3, "Personal");
  await writeNote(page, both, 3, "Grupal");
  const accent = await tokenColor(page, "accent");
  const ink = await tokenColor(page, "ink");
  await expect(page.locator(".sk-board[role=grid]")).not.toHaveAttribute("data-notes-same");
  const p = await underlineOf(page, personal, ".n.p", 3);
  const gp = await underlineOf(page, both, ".n.gp", 3);
  expect(p).toMatchObject({ color: accent, weight: "400", thickness: "1px" });
  expect(gp).toMatchObject({ color: ink, weight: "600", thickness: "1px", lineColor: accent });
});

test("T-42.8 the states of the board do not depend on the chosen colour", async ({
  player,
  game,
}) => {
  const page = await player();
  const { empty, solution } = await soloMatch(page, game);
  const [placed, wrong, other] = empty;
  if (placed === undefined || wrong === undefined || other === undefined)
    throw new Error("Not enough empty cells");

  const ink = await tokenColor(page, "ink");
  const accent = await tokenColor(page, "accent");
  const danger = await tokenColor(page, "danger");

  // Un error de verdad: el dígito erróneo se dibuja en danger, también con un color elegido.
  await storeSameColors(page, 1);
  await page.keyboard.press("Escape");
  await place(page, wrong, wrongDigit(solution, wrong));
  await expect(page.locator(".sk-gc.err .dg")).toHaveCSS("color", danger);

  await place(page, placed, solution[placed] ?? 0);
  await expect(cell(page, placed)).toHaveAttribute("aria-label", /resuelta/);
  await cell(page, other).click();

  // Con cada color, y con Predeterminado para comparar. Las sondas usan las clases reales.
  const states = async () =>
    page.evaluate(() => {
      const board = document.querySelector(".sk-board[role=grid]");
      if (!board) throw new Error("No board");
      const hot = board.querySelector(".cg.hot");
      if (!hot) throw new Error("No hot cage");
      const hotStyle = getComputedStyle(hot);
      const widths = [
        hotStyle.borderTopWidth,
        hotStyle.borderBottomWidth,
        hotStyle.borderLeftWidth,
        hotStyle.borderRightWidth,
      ];
      const ring = board.querySelector(".sk-selring");
      if (!ring) throw new Error("No ring");
      const probe = document.createElement("div");
      probe.className = "sk-gc err same";
      probe.innerHTML = '<span class="dg"><span class="dgt">5</span></span>';
      board.append(probe);
      const err = probe.querySelector(".dg");
      const dgt = probe.querySelector(".dgt");
      if (!err || !dgt) throw new Error("No probe");
      const result = {
        hot: widths.find((width) => width !== "0px"),
        selection: getComputedStyle(ring).borderTopColor,
        error: getComputedStyle(err).color,
        same: getComputedStyle(dgt, "::after").borderTopColor,
        lineColor: hotStyle.borderTopColor,
      };
      probe.remove();
      return result;
    });

  await openSettings(page);
  for (let option = 0; option <= 9; option++) {
    for (const group of ["Jaula", "Suma", "Personal", "Grupal"]) {
      await page
        .getByRole("group", { name: group, exact: true })
        .getByRole("radio")
        .nth(option)
        .check();
    }
    const seen = await states();
    expect(seen, `colour ${String(option)}`).toMatchObject({
      hot: "3px",
      selection: accent,
      error: danger,
      same: ink,
    });
    // Control: la jaula sí cambió de color, así que la sonda ve el color elegido.
    if (option > 0) expect(seen.lineColor).toBe(await tokenColor(page, `pal-${String(option)}`));
  }
});

/** Elige el mismo color para todo desde Ajustes. */
async function storeSameColors(page: Page, option: number) {
  await openSettings(page);
  for (const group of ["Jaula", "Suma", "Personal", "Grupal"]) {
    await page
      .getByRole("group", { name: group, exact: true })
      .getByRole("radio")
      .nth(option)
      .check();
  }
}

test("T-42.4 in a real browser: arrows stay in the group, and the chosen colour has ring and mark", async ({
  player,
  game,
}) => {
  const page = await player();
  await soloMatch(page, game);
  await openSettings(page);

  const jaula = page.getByRole("group", { name: "Jaula", exact: true }).getByRole("radio");
  await jaula.first().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(jaula.last()).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(jaula.first()).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(jaula.nth(1)).toBeChecked();
  await expect(jaula.nth(1)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("group", { name: "Suma", exact: true }).getByRole("radio").first(),
  ).toBeFocused();

  // El anillo se anima: se espera su valor final, con un plazo. Si no llega, la prueba falla.
  const dot = (index: number) => page.locator('.swatch[data-color="' + String(index) + '"] .dot');
  const RING_DONE = 2_000;
  const chosen = dot(1).first();
  await expect(chosen).toHaveCSS("box-shadow", /0px 0px 0px 2px.*0px 0px 0px 4px/, {
    timeout: RING_DONE,
  });
  const mark = (target: typeof chosen) =>
    target.evaluate((element) => getComputedStyle(element, "::after").content);
  expect(await mark(chosen)).not.toBe("none");
  const other = dot(2).first();
  await expect(other).toHaveCSS("box-shadow", "none", { timeout: RING_DONE });
  expect(await mark(other)).toBe("none");
  // El que deja de estar elegido también llega a su estado final.
  await expect(dot(0).first()).toHaveCSS("box-shadow", "none", { timeout: RING_DONE });
  await expect(page.locator('.swatch[data-color="1"]').first()).toHaveAttribute(
    "title",
    "Frambuesa",
  );
});

/** Las parejas de elementos del cuerpo del diálogo que se solapan. */
async function overlaps(page: Page) {
  // Sin desplazar: al desplazar, la vista previa fija flota sobre el resto, como debe ser.
  await page.locator(".dialog .dbody").evaluate((body) => {
    body.scrollTop = 0;
  });
  return page.locator(".dialog .dbody > *").evaluateAll((items) => {
    const found: string[] = [];
    const boxes = items.map((item) => item.getBoundingClientRect());
    boxes.forEach((a, i) => {
      boxes.slice(i + 1).forEach((b, j) => {
        const apart =
          a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left;
        if (!apart) found.push(`${String(i)}-${String(i + 1 + j)}`);
      });
    });
    // Cada interruptor debe medir al menos lo que mide su texto.
    for (const item of items) {
      if (item.scrollHeight > item.clientHeight + 1) found.push(`${item.tagName} recortado`);
    }
    return found;
  });
}

/** Sin desplazamiento horizontal en la página ni en el diálogo. */
async function expectNoHorizontalScroll(page: Page) {
  const sizes = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.querySelector(".dialog .dbody");
    return {
      page: root.scrollWidth - root.clientWidth,
      dialog: body ? body.scrollWidth - body.clientWidth : 0,
    };
  });
  expect(sizes).toEqual({ page: 0, dialog: 0 });
}

for (const viewport of [PHONE, DESKTOP, LANDSCAPE]) {
  test(`T-42.9 the panel fits at ${String(viewport.width)} × ${String(viewport.height)}`, async ({
    player,
    game,
  }) => {
    const page = await player();
    await page.setViewportSize(viewport);
    await soloMatch(page, game);
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: viewport === DESKTOP ? "Ajustes" : /^Menú/ }).click();
    if (viewport !== DESKTOP) await page.getByRole("menuitem", { name: "Ajustes" }).click();
    const dialog = page.getByRole("dialog", { name: "Ajustes" });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await overlaps(page)).toEqual([]);

    // Los objetivos: cada color y cada interruptor miden 44 px o más.
    const swatches = await page.locator(".swatch").evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    );
    expect(swatches).toHaveLength(40);
    for (const box of swatches) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    for (const box of await dialog
      .getByRole("switch")
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height)))
      expect(box).toBeGreaterThanOrEqual(44);

    // El diálogo entero está en pantalla, y «Cerrar» se alcanza sin desplazar la página.
    const panel = await dialog.boundingBox();
    expect(panel).not.toBeNull();
    expect((panel?.y ?? 0) + (panel?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    const close = dialog.locator(".dactions").getByRole("button", { name: "Cerrar" });
    const closeBox = await close.boundingBox();
    expect((closeBox?.y ?? 0) + (closeBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height);

    // El último selector se alcanza desplazando el cuerpo del diálogo.
    const lastSwatch = page.locator(".swatch").last();
    await lastSwatch.scrollIntoViewIfNeeded();
    await expect(lastSwatch).toBeInViewport();

    // La vista previa queda fija al desplazar solo en un teléfono en vertical.
    const preview = page.locator(".cpreview");
    const position = await preview.evaluate((element) => getComputedStyle(element).position);
    expect(position).toBe(viewport === PHONE ? "sticky" : "static");
    if (viewport === PHONE) await expect(preview).toBeInViewport();
    if (viewport === PHONE) {
      // Un control enfocado no queda debajo de la vista previa fija.
      const first = dialog.getByRole("switch", { name: /^Usar notas/ });
      await page.locator(".swatch input").last().focus();
      await first.focus();
      await expect(first).toBeFocused();
      // Chromium centra lo enfocado; otros navegadores lo alinean al borde más cercano, como aquí.
      await lastSwatch.scrollIntoViewIfNeeded();
      await first.evaluate((element) => {
        element.scrollIntoView({ block: "nearest" });
      });
      const previewBox = await preview.boundingBox();
      const firstBox = await first.boundingBox();
      expect(firstBox?.y ?? 0).toBeGreaterThanOrEqual(
        (previewBox?.y ?? 0) + (previewBox?.height ?? 0),
      );
    }

    // Sin notas personales, la página sigue sin desplazamiento horizontal.
    await page.getByRole("switch", { name: /^Notas personales/ }).click();
    await expectNoHorizontalScroll(page);
    expect(await overlaps(page)).toEqual([]);
    await close.click();
    await expect(dialog).not.toBeVisible();
    await expectNoHorizontalScroll(page);
    await expect(page.getByRole("button", { name: "Personal", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Notas personales" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Notas grupales" })).toBeVisible();

    // Los demás diálogos siguen como estaban.
    await page.setViewportSize(DESKTOP);
    await page.getByRole("button", { name: "Salir", exact: true }).click();
    const leave = page.getByRole("alertdialog");
    const width = (await leave.boundingBox())?.width;
    expect(width).toBe(440);
    await page.getByRole("button", { name: "Quedarme" }).click();
  });
}

/** Lee las medidas que el tablero fijó para sus notas. */
function noteVars(page: Page) {
  return page.locator(".sk-board[role=grid]").evaluate((board) => {
    const value = (name: string) => (board as HTMLElement).style.getPropertyValue(name);
    return {
      cell: parseFloat(value("--cell")),
      sumH: parseFloat(value("--sum-h")),
      fontSize: parseFloat(value("--n-fs")),
      top: parseFloat(value("--n-top")),
      offset: parseFloat(value("--n-offset")),
      layer: parseFloat(value("--n-z")),
    };
  });
}

for (const viewport of [PHONE, DESKTOP]) {
  test(`T-44.3 bold and the dotted line do not move the notes at ${String(viewport.width)} px`, async ({
    player,
    game,
  }) => {
    const page = await player();
    await page.setViewportSize(viewport);
    const { empty, solution } = await soloMatch(page, game, { personal: 5, group: 5 });
    const [placed, target] = empty;
    if (placed === undefined || target === undefined) throw new Error("Not enough empty cells");
    const digit = solution[placed] ?? 0;
    await place(page, placed, digit);
    await expect(cell(page, placed)).toHaveAttribute("aria-label", /resuelta/);

    await setMode(page, "Notas");
    await writeNote(page, target, digit, "Personal");
    await writeNote(page, target, digit, "Grupal");
    await writeNote(page, target, (digit % 9) + 1, "Personal");
    await expect(noteIn(page, target, ".n.gp", digit)).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const gridCell = page.locator(".sk-board[role=grid] [role=gridcell]").nth(target);
    const boxes = () =>
      gridCell.locator(".n").evaluateAll((items) =>
        items.map((item) => {
          const box = item.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height];
        }),
      );
    const plain = await boxes();
    expect(plain).toHaveLength(9);
    // Siguen en 3 filas y 3 columnas.
    expect(new Set(plain.map(([x]) => x)).size).toBe(3);
    expect(new Set(plain.map(([, y]) => y)).size).toBe(3);

    // La cuadrícula está donde dice su medida; a 360 px, subida, y a 1280 px, como antes.
    const vars = await noteVars(page);
    const raised = viewport === PHONE;
    expect(vars.top).toBe(vars.sumH + 1 - (raised ? 3 : 0));
    expect(vars.offset).toBeCloseTo(raised ? 0 : Math.max(1, vars.fontSize * 0.14), 5);
    const placedTop = await gridCell.evaluate((element) => {
      const notes = element.querySelector(".notes");
      if (!notes) throw new Error("No notes");
      return (
        notes.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientTop
      );
    });
    expect(Math.abs(placedTop - vars.top)).toBeLessThanOrEqual(0.5);

    // Con negrita.
    await cell(page, placed).click();
    const strong = noteIn(page, target, ".n.gp.strong", digit);
    await expect(strong).toHaveCSS("font-weight", "800");
    expect(await boxes()).toEqual(plain);

    // La punteada no mueve nada frente a la continua.
    await expect(strong).toHaveCSS("text-decoration-style", "dotted");
    await page.locator(".sk-board[role=grid]").evaluate((board) => {
      board.removeAttribute("data-notes-same");
    });
    await expect(strong).toHaveCSS("text-decoration-style", "solid");
    expect(await boxes()).toEqual(plain);
  });
}

/** Lee en otra página, sin CSP, dónde está la tinta roja de una captura, en píxeles CSS. */
async function redInk(decoder: Page, shot: Buffer, scale: number) {
  return decoder.evaluate(
    async ({ data, factor }) => {
      const response = await fetch(`data:image/png;base64,${data}`);
      const image = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let top = Infinity;
      let bottom = -Infinity;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const i = (y * image.width + x) * 4;
          const [r, g, b] = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
          // Rojo puro: el suavizado de color del texto oscuro de la suma no llega a este umbral.
          if (r > 200 && g < 130 && b < 130) {
            if (y < top) top = y;
            if (y > bottom) bottom = y;
          }
        }
      }
      return { top: top / factor, bottom: (bottom + 1) / factor };
    },
    { data: shot.toString("base64"), factor: scale },
  );
}

/**
 * Cuánto entra la raya de una nota en la de la fila de abajo, en la columna izquierda de una celda:
 * positivo, entra; 0, la toca; negativo, hay hueco.
 */
async function lineOverNext(page: Page, decoder: Page, index: number, scale: number) {
  const gridCell = page.locator(".sk-board[role=grid] [role=gridcell]").nth(index);
  const paint = (show: number, kind: "line" | "digit" | "none") =>
    gridCell.locator(".n").evaluateAll(
      (items, { which, how }) => {
        items.forEach((item, i) => {
          const style = (item as HTMLElement).style;
          style.color = "transparent";
          style.textDecorationLine = "none";
          if (i !== which) return;
          if (how === "digit") style.color = "#ff0000";
          if (how === "line") {
            style.textDecorationLine = "underline";
            style.textDecorationColor = "#ff0000";
            style.textDecorationSkipInk = "none";
          }
        });
      },
      { which: show, how: kind },
    );
  const measure = async (show: number, kind: "line" | "digit") => {
    await paint(show, kind);
    return redInk(decoder, await gridCell.screenshot({ animations: "disabled" }), scale);
  };
  // Solo la nota medida: el borde de color del número de la suma también parece rojo.
  const others = gridCell.locator(".sum, .cg");
  await others.evaluateAll((items) => {
    for (const item of items) (item as HTMLElement).style.visibility = "hidden";
  });
  const results: number[] = [];
  for (const [upper, lower] of [
    [0, 3],
    [3, 6],
  ] as const) {
    const line = await measure(upper, "line");
    const next = await measure(lower, "digit");
    results.push(line.bottom - next.top);
  }
  await gridCell.locator(".n, .sum, .cg").evaluateAll((items) => {
    for (const item of items) item.removeAttribute("style");
  });
  return Math.max(...results);
}

const SIZES = [
  { width: 320, height: 568, check: "report" },
  { width: 360, height: 640, check: "tight" },
  { width: 375, height: 667, check: "tight" },
  { width: 390, height: 844, check: "tight" },
  { width: 412, height: 915, check: "tight" },
  { width: 430, height: 932, check: "tight" },
  { width: 768, height: 1024, check: "unchanged" },
  { width: 1280, height: 800, check: "unchanged" },
] as const;

for (const scale of [2, 3]) {
  test(`T-42.20 the line of a personal note stays out of the note below, at scale ${String(scale)}`, async ({
    player,
    browser,
    game,
  }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ deviceScaleFactor: scale, viewport: PHONE });
    const blank = await browser.newContext();
    try {
      const page = await player({ context });
      const decoder = await blank.newPage();
      const { empty } = await soloMatch(page, game);
      const rowOf = (index: number) => Math.floor(index / 9);
      const pick = (rows: readonly number[]) => {
        const found = empty.find((index) => rows.includes(rowOf(index)));
        if (found === undefined) throw new Error(`No empty cell in rows ${rows.join()}`);
        return found;
      };
      const cells = {
        firstRow: pick([0]),
        boxBottom: pick([2, 5]),
        normal: pick([1, 3, 4, 6, 7]),
      };
      await setMode(page, "Notas");
      for (const index of Object.values(cells)) {
        await cell(page, index).click();
        for (const digit of [1, 4, 7]) await page.keyboard.press(String(digit));
        await expect(
          page.locator(".sk-board[role=grid] [role=gridcell]").nth(index).locator(".n.p"),
        ).toHaveCount(3);
      }
      await cell(
        page,
        pick([1, 3, 4, 6, 7, 8].filter((row) => row !== rowOf(cells.normal))),
      ).click();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      for (const size of SIZES) {
        await page.setViewportSize(size);
        const expected = (await page.locator(".sk-board[role=grid]").boundingBox())?.width ?? 0;
        await expect.poll(async () => (await noteVars(page)).cell).toBeCloseTo(expected / 9, 1);
        const vars = await noteVars(page);
        const crossing = {
          firstRow: await lineOverNext(page, decoder, cells.firstRow, scale),
          boxBottom: await lineOverNext(page, decoder, cells.boxBottom, scale),
          normal: await lineOverNext(page, decoder, cells.normal, scale),
        };
        console.log(
          `T-42.20 scale ${String(scale)} ${String(size.width)} px: cell ${vars.cell.toFixed(2)}, font ${String(vars.fontSize)}, top ${String(vars.top)} (sum ${String(vars.sumH)}), offset ${vars.offset.toFixed(2)}, line over next ${JSON.stringify(crossing)}`,
        );
        // La regla de cada ancho: raya pegada por debajo de 48 px de celda; subida y encima de la
        // suma, por debajo de 40 px.
        const raised = vars.cell < 40;
        expect(vars.top, `top at ${String(size.width)}`).toBe(vars.sumH + 1 - (raised ? 3 : 0));
        expect(vars.layer, `layer at ${String(size.width)}`).toBe(raised ? 4 : 2);
        expect(vars.offset, `offset at ${String(size.width)}`).toBeCloseTo(
          vars.cell < 48 ? 0 : Math.max(1, vars.fontSize * 0.14),
          5,
        );
        if (size.check === "report") continue;
        const worst = Math.max(crossing.firstRow, crossing.boxBottom, crossing.normal);
        expect(worst, `${String(size.width)} px at scale ${String(scale)}`).toBeLessThanOrEqual(0);
        if (size.check === "unchanged") {
          expect(vars.cell).toBeGreaterThanOrEqual(48);
          expect(vars.top).toBe(vars.sumH + 1);
          expect(vars.offset).toBeCloseTo(Math.max(1, vars.fontSize * 0.14), 5);
        }
      }

      // Negativa: con la posición y la raya de antes, el detector marca el cruce a 360 px.
      await page.setViewportSize(PHONE);
      await expect.poll(async () => (await noteVars(page)).top).toBe(9);
      await page.locator(".sk-board[role=grid]").evaluate((board) => {
        const style = (board as HTMLElement).style;
        style.setProperty("--n-top", "12px");
        style.setProperty("--n-offset", "1.12px");
      });
      expect(await lineOverNext(page, decoder, cells.normal, scale)).toBeGreaterThan(0);
    } finally {
      await context.close();
      await blank.close();
    }
  });
}

// Suma tapada por las notas (T-42.20). Mide todo el tablero sin repintar el texto: solo alterna
// `visibility`, porque el suavizado depende del color. Cada captura cubre el tablero entero, y sus
// píxeles se reparten entre las celdas por su centro.

const BOARD_CELLS = 81;
const BOARD_SIZE = 9;
const INK_COVERAGE = 0.5;
const INFO_COVERAGE = 0.25;
const MIN_CHANNEL_SPAN = 32;
const SUM_TEXTS = ["12", "16", "17", "21", "22"] as const;
const NOTE_WEIGHTS = ["400", "800"] as const;
const MEASURED_WIDTHS = [PHONE, { width: 375, height: 667 }] as const;
const TOTAL_CASES = 40;

interface Image {
  readonly width: number;
  readonly height: number;
  /** Cuatro bytes por píxel: rojo, verde, azul y alfa. */
  readonly data: Uint8Array;
}

interface TextColor {
  readonly rgb: readonly number[];
  readonly alpha: number;
}

/** Tinta de la suma y píxeles tapados de cada celda, con un umbral de cobertura. */
interface InkLevel {
  readonly ink: Int32Array;
  readonly covered: Int32Array;
}

interface CaseResult {
  readonly strict: InkLevel;
  readonly info: InkLevel;
  readonly outsideInk: number;
  readonly recountGap: number;
  readonly differsFromBoth: number;
  readonly noValidChannel: number;
}

/** Decodifica una captura PNG sin gestión de color: los bytes son los que dibujó el navegador. */
function decodePng(png: Buffer): Image {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const channels = png[25] === 6 ? 4 : 3;
  if (png[24] !== 8 || png[28] !== 0 || (png[25] !== 6 && png[25] !== 2)) {
    throw new Error("Unexpected PNG format");
  }
  const parts: Buffer[] = [];
  for (let at = 8; at + 8 <= png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString("latin1", at + 4, at + 8) === "IDAT") {
      parts.push(png.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const data = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++] ?? 0;
    const line = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (line[x - channels] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const corner = x >= channels ? (previous[x - channels] ?? 0) : 0;
      const value = raw[at++] ?? 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - corner;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toCorner = Math.abs(estimate - corner);
        if (toLeft <= toUp && toLeft <= toCorner) predicted = left;
        else predicted = toUp <= toCorner ? up : corner;
      }
      line[x] = (value + predicted) & 255;
    }
    for (let x = 0; x < width; x++) {
      const target = 4 * (x + y * width);
      data[target] = line[x * channels] ?? 0;
      data[target + 1] = line[x * channels + 1] ?? 0;
      data[target + 2] = line[x * channels + 2] ?? 0;
      data[target + 3] = channels === 4 ? (line[x * channels + 3] ?? 0) : 255;
    }
    previous = line;
  }
  return { width, height, data };
}

/** El intervalo semiabierto [edge, siguiente) que contiene la posición; -1 si queda fuera. */
function intervalOf(edges: readonly number[], position: number): number {
  for (let index = 0; index + 1 < edges.length; index++) {
    if ((edges[index] ?? 0) <= position && position < (edges[index + 1] ?? 0)) return index;
  }
  return -1;
}

/** A qué intervalo va el centro de cada píxel de una captura que empieza en `start` (CSS). */
function pixelIntervals(edges: readonly number[], start: number, pixels: number, scale: number) {
  return Array.from({ length: pixels }, (_, pixel) =>
    intervalOf(edges, start + (pixel + 0.5) / scale),
  );
}

function parseColor(css: string): TextColor {
  const match = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(css);
  if (!match) throw new Error(`Unexpected text colour: ${css}`);
  return {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  };
}

/**
 * Cuánto cubre el texto un píxel, en el canal de mayor cobertura: |captura − base| / |color − base|.
 * Con transparencia, el color es el final, compuesto sobre la base. Ignora los canales con una
 * diferencia menor que 32, y devuelve null si no queda ninguno.
 */
function coverage(image: Uint8Array, base: Uint8Array, at: number, text: TextColor): number | null {
  let best: number | null = null;
  for (let channel = 0; channel < 3; channel++) {
    const under = base[at + channel] ?? 0;
    const final = text.alpha * (text.rgb[channel] ?? 0) + (1 - text.alpha) * under;
    const span = Math.abs(final - under);
    if (span < MIN_CHANNEL_SPAN) continue;
    const value = Math.abs((image[at + channel] ?? 0) - under) / span;
    if (best === null || value > best) best = value;
  }
  return best;
}

function differs(first: Uint8Array, second: Uint8Array, at: number): boolean {
  return (
    first[at] !== second[at] || first[at + 1] !== second[at + 1] || first[at + 2] !== second[at + 2]
  );
}

const emptyLevel = (): InkLevel => ({
  ink: new Int32Array(BOARD_CELLS),
  covered: new Int32Array(BOARD_CELLS),
});

/** Un recuento aparte de la tinta de toda la captura, sin pasar por el reparto entre celdas. */
function countInk(image: Image, base: Image, text: TextColor): number {
  let count = 0;
  for (let at = 0; at < image.data.length; at += 4) {
    if (!differs(image.data, base.data, at)) continue;
    const value = coverage(image.data, base.data, at, text);
    if (value !== null && value >= INK_COVERAGE) count++;
  }
  return count;
}

function analyzeCase(
  shots: {
    readonly base: Image;
    readonly sum: Image;
    readonly note: Image;
    readonly both: Image;
  },
  columns: readonly number[],
  rows: readonly number[],
  colors: { readonly sum: TextColor; readonly note: TextColor },
): CaseResult {
  const base = shots.base.data;
  const sum = shots.sum.data;
  const note = shots.note.data;
  const both = shots.both.data;
  const strict = emptyLevel();
  const info = emptyLevel();
  let outsideInk = 0;
  let outsideSum = 0;
  let differsFromBoth = 0;
  let noValidChannel = 0;
  for (let y = 0; y < shots.base.height; y++) {
    const row = rows[y] ?? -1;
    for (let x = 0; x < shots.base.width; x++) {
      const column = columns[x] ?? -1;
      const at = 4 * (x + y * shots.base.width);
      const sumChanged = differs(sum, base, at);
      const noteChanged = differs(note, base, at);
      // La captura con las dos debe ser idéntica a la que tiene el único texto de ese píxel.
      if (!sumChanged && !noteChanged) {
        if (differs(both, base, at)) differsFromBoth++;
        continue;
      }
      if (sumChanged !== noteChanged && differs(both, sumChanged ? sum : note, at)) {
        differsFromBoth++;
      }
      const sumCover = sumChanged ? coverage(sum, base, at, colors.sum) : 0;
      const noteCover = noteChanged ? coverage(note, base, at, colors.note) : 0;
      if (sumCover === null || noteCover === null) {
        noValidChannel++;
        continue;
      }
      if (row < 0 || column < 0) {
        if (sumCover >= INK_COVERAGE) outsideSum++;
        if (sumCover >= INK_COVERAGE || noteCover >= INK_COVERAGE) outsideInk++;
        continue;
      }
      const index = row * BOARD_SIZE + column;
      for (const [level, threshold] of [
        [strict, INK_COVERAGE],
        [info, INFO_COVERAGE],
      ] as const) {
        if (sumCover < threshold) continue;
        level.ink[index] = (level.ink[index] ?? 0) + 1;
        if (noteCover >= threshold) level.covered[index] = (level.covered[index] ?? 0) + 1;
      }
    }
  }
  const attributed = strict.ink.reduce((total, value) => total + value, 0) + outsideSum;
  return {
    strict,
    info,
    outsideInk,
    recountGap: countInk(shots.sum, shots.base, colors.sum) - attributed,
    differsFromBoth,
    noValidChannel,
  };
}

const cellName = (index: number) =>
  `F${String(Math.floor(index / BOARD_SIZE) + 1)}C${String((index % BOARD_SIZE) + 1)}`;

const percentOf = (level: InkLevel, index: number) => {
  const ink = level.ink[index] ?? 0;
  return ink === 0 ? 0 : (100 * (level.covered[index] ?? 0)) / ink;
};

/** Los valores por celda de un caso o de varios: el máximo y las celdas que lo alcanzan. */
function worstOf(values: readonly number[]) {
  const max = Math.max(...values);
  const cells = values.flatMap((value, index) => (value === max ? [cellName(index)] : []));
  return { max, cells };
}

/** Los bordes de filas y columnas, y cuánto se aparta de ellos la celda que más se aparta. */
function edgesOf(boxes: readonly CellBox[]) {
  const box = (index: number) => {
    const found = boxes[index];
    if (!found) throw new Error(`No cell ${String(index)}`);
    return found;
  };
  const xs = Array.from({ length: BOARD_SIZE }, (_, column) => box(column).left);
  xs.push(box(BOARD_SIZE - 1).right);
  const ys = Array.from({ length: BOARD_SIZE }, (_, row) => box(row * BOARD_SIZE).top);
  ys.push(box(BOARD_CELLS - BOARD_SIZE).bottom);
  let gap = 0;
  boxes.forEach((cellBox, index) => {
    const row = Math.floor(index / BOARD_SIZE);
    const column = index % BOARD_SIZE;
    gap = Math.max(
      gap,
      Math.abs(cellBox.left - (xs[column] ?? 0)),
      Math.abs(cellBox.right - (xs[column + 1] ?? 0)),
      Math.abs(cellBox.top - (ys[row] ?? 0)),
      Math.abs(cellBox.bottom - (ys[row + 1] ?? 0)),
    );
  });
  return { xs, ys, gap };
}

interface CellBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Deja el tablero con esa suma y ese peso, y cada texto visible u oculto. No cambia sus colores. */
function paintBoard(
  page: Page,
  look: {
    readonly text: string;
    readonly weight: string;
    readonly showSum: boolean;
    readonly showNotes: boolean;
  },
) {
  return page
    .locator(".sk-board[role=grid]")
    .evaluate((board, { text, weight, showSum, showNotes }) => {
      for (const gridCell of board.querySelectorAll("[role=gridcell]")) {
        let sum = gridCell.querySelector<HTMLElement>(".sum");
        if (!sum) {
          sum = document.createElement("span");
          sum.className = "sum";
          gridCell.prepend(sum);
        }
        sum.textContent = text;
        // Todas las celdas como sin seleccionar: la selección tiñe su fila, su columna, su caja y su
        // jaula, y ese fondo cambia la medida de esas celdas.
        gridCell.classList.remove("sel", "rel");
        for (const hidden of gridCell.querySelectorAll<HTMLElement>(".cg, .sk-selring")) {
          hidden.style.visibility = "hidden";
        }
        sum.style.visibility = showSum ? "visible" : "hidden";
        for (const note of gridCell.querySelectorAll<HTMLElement>(".n")) {
          note.style.visibility = showNotes ? "visible" : "hidden";
          note.style.textDecorationLine = "none";
          note.style.fontWeight = weight;
        }
      }
    }, look);
}

test("T-42.20 every pixel of the board goes to one cell, or to none", () => {
  const edges = Array.from({ length: 10 }, (_, index) => (index * 112) / 3);
  // Un centro justo en un borde va al intervalo siguiente.
  expect(intervalOf([0, 2, 4], 2)).toBe(1);
  expect(intervalOf([0, 2, 4], 0)).toBe(0);
  // Fuera del tablero no va a ninguna celda.
  expect(intervalOf([0, 2, 4], 4)).toBe(-1);
  expect(intervalOf([0, 2, 4], -0.5)).toBe(-1);
  for (const scale of [2, 3]) {
    const pixels = pixelIntervals(edges, 0, 336 * scale, scale);
    expect(pixels).toHaveLength(336 * scale);
    expect(pixels).not.toContain(-1);
    expect(new Set(pixels).size).toBe(BOARD_SIZE);
    // Los índices solo avanzan: ningún píxel queda entre dos celdas ni en dos a la vez.
    expect([...pixels].sort((first, second) => first - second)).toEqual(pixels);
  }
});

test("T-42.20 coverage uses the final colour and refuses a pixel with no valid channel", () => {
  const paper = new Uint8Array([250, 250, 250, 255]);
  const half = new Uint8Array([150, 150, 150, 255]);
  const opaque = { rgb: [50, 50, 50], alpha: 1 };
  expect(coverage(half, paper, 0, opaque)).toBeCloseTo(0.5, 5);
  // Con transparencia, el texto solo puede llegar a su color compuesto.
  expect(coverage(half, paper, 0, { rgb: [50, 50, 50], alpha: 0.5 })).toBeCloseTo(1, 5);
  // Un canal con poca diferencia no decide: aquí cuenta solo el azul.
  const mixed = new Uint8Array([240, 240, 150, 255]);
  expect(coverage(mixed, paper, 0, { rgb: [230, 230, 50], alpha: 1 })).toBeCloseTo(0.5, 5);
  // Verificación negativa: sin ningún canal válido no hay cobertura.
  expect(coverage(half, paper, 0, { rgb: [240, 240, 240], alpha: 1 })).toBeNull();
  expect(coverage(half, paper, 0, { rgb: [50, 50, 50], alpha: 0.1 })).toBeNull();
});

test("T-42.20 negative check: the analysis marks a repaint, ink off the board and no channel", () => {
  const paper = [250, 250, 250, 255];
  const dark = [50, 50, 50, 255];
  const image = (...pixels: readonly (readonly number[])[]): Image => ({
    width: pixels.length,
    height: 1,
    data: new Uint8Array(pixels.flat()),
  });
  const colors = {
    sum: { rgb: [50, 50, 50], alpha: 1 },
    note: { rgb: [50, 50, 50], alpha: 1 },
  };
  const base = image(paper, paper, paper);
  const sum = image(dark, dark, paper);
  const note = image(paper, dark, paper);
  const both = image(dark, dark, paper);
  const clean = analyzeCase({ base, sum, note, both }, [0, 0, 0], [0], colors);
  expect(percentOf(clean.strict, 0)).toBe(50);
  expect(clean.differsFromBoth).toBe(0);
  expect(clean.recountGap).toBe(0);
  // Una captura con las dos que no coincide con lo que hay en cada una: se alteró el dibujo.
  const repainted = image([60, 60, 60, 255], dark, [240, 240, 240, 255]);
  const altered = analyzeCase({ base, sum, note, both: repainted }, [0, 0, 0], [0], colors);
  expect(altered.differsFromBoth).toBe(2);
  // Un píxel fuera del tablero no se pierde.
  const outside = analyzeCase({ base, sum, note, both }, [0, 0, -1], [0], colors);
  expect(outside.outsideInk).toBe(0);
  const offBoard = analyzeCase({ base, sum, note, both }, [-1, 0, 0], [0], colors);
  expect(offBoard.outsideInk).toBe(1);
  expect(offBoard.recountGap).toBe(0);
  // Sin canal válido no se cuenta nada, y queda registrado.
  const flat = { rgb: [245, 245, 245], alpha: 1 };
  const refused = analyzeCase({ base, sum, note, both }, [0, 0, 0], [0], {
    sum: flat,
    note: colors.note,
  });
  expect(refused.noValidChannel).toBe(2);
});

/** La fuente con la que se dibujó de verdad un elemento, tal como la informa el navegador. */
async function platformFonts(session: CDPSession, selector: string): Promise<string> {
  const { root } = await session.send("DOM.getDocument");
  const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
  return fonts
    .map(
      (font) =>
        `${font.familyName} (${font.isCustomFont ? "served by the web" : "system"}, ${String(font.glyphCount)} glyphs)`,
    )
    .join(", ");
}

// A 360 px y a las dos escalas, con colores reales y umbral de cobertura de 0,5 (docs/diseno.md §2.5).
const NOTE_OVER_SUM_LIMIT = 6.0;

for (const [scale, firstCase] of [
  [3, 0],
  [2, 20],
] as const) {
  test(`T-42.20 the note over the sum covers at most ${NOTE_OVER_SUM_LIMIT.toFixed(1)} % of its ink at 360 px and scale ${String(scale)}, and nothing at 375 px`, async ({
    player,
    browser,
    game,
  }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ deviceScaleFactor: scale, viewport: PHONE });
    try {
      const page = await player({ context });
      const code = await createRoom(page, "Inés");
      await page.getByRole("radio", { name: /Experto/ }).check();
      await start(page, [page]);
      expect(emptyCells(game, code)).toHaveLength(BOARD_CELLS);

      await setMode(page, "Notas");
      for (let index = 0; index < BOARD_CELLS; index++) {
        await cell(page, index).click();
        await page.keyboard.press("1");
        await page.keyboard.press("2");
        await expect
          .poll(() => playerOf(game, code, "Inés").personalNotes[index], {
            message: `notes 1 and 2 of ${cellName(index)}`,
          })
          .toBe(digitBit(1) | digitBit(2));
        // Dos comandos cada 110 ms: por debajo del tope de 20 por segundo (SPEC, §4.8).
        await page.waitForTimeout(110);
      }
      await expect(page.locator(".sk-board[role=grid] .n.p")).toHaveCount(2 * BOARD_CELLS);
      await page.mouse.move(0, 0);
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return document.fonts.ready.then(() => undefined);
      });
      const textColors = await page.locator(".sk-board[role=grid]").evaluate((board) => {
        const colorsOf = (selector: string) => [
          ...new Set(
            [...board.querySelectorAll(selector)].map((item) => getComputedStyle(item).color),
          ),
        ];
        return { notes: colorsOf(".n.p"), sums: colorsOf(".sum") };
      });
      const [noteCss] = textColors.notes;
      const [sumCss] = textColors.sums;
      expect(textColors.notes).toHaveLength(1);
      expect(textColors.sums).toHaveLength(1);
      if (noteCss === undefined || sumCss === undefined) throw new Error("No text colour");
      const colors = { sum: parseColor(sumCss), note: parseColor(noteCss) };
      console.log(`T-42.20 text colours: sum ${sumCss}, note ${noteCss}`);

      const session = await context.newCDPSession(page);
      await session.send("DOM.enable");
      await session.send("CSS.enable");
      for (const weight of NOTE_WEIGHTS) {
        await paintBoard(page, {
          text: SUM_TEXTS[0],
          weight,
          showSum: true,
          showNotes: true,
        });
        // El navegador solo conoce la fuente de un texto ya dibujado.
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
              });
            }),
        );
        const first = ".sk-board[role=grid] [role=gridcell]";
        console.log(
          `T-42.20 fonts, ${process.platform}, scale ${String(scale)}, note weight ${weight}: sum ${await platformFonts(session, `${first} .sum`)}; note ${await platformFonts(session, `${first} .n.p`)}`,
        );
      }

      const results: { width: number; result: CaseResult }[] = [];
      let measured = 0;
      for (const viewport of MEASURED_WIDTHS) {
        await page.setViewportSize(viewport);
        await expect
          .poll(async () => (await noteVars(page)).cell)
          .toBeCloseTo(
            ((await page.locator(".sk-board[role=grid]").boundingBox())?.width ?? 0) / BOARD_SIZE,
            1,
          );
        await page.locator(".sk-board[role=grid]").evaluate((board) => {
          board.scrollIntoView({ block: "nearest" });
        });
        const boxes = await page
          .locator(".sk-board[role=grid] [role=gridcell]")
          .evaluateAll((cells) =>
            cells.map((item): CellBox => {
              const box = item.getBoundingClientRect();
              return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
            }),
          );
        expect(boxes).toHaveLength(BOARD_CELLS);
        const { xs, ys, gap } = edgesOf(boxes);
        expect(gap).toBeLessThanOrEqual(0.01);
        const firstX = xs[0] ?? 0;
        const firstY = ys[0] ?? 0;
        const lastX = xs[BOARD_SIZE] ?? 0;
        const lastY = ys[BOARD_SIZE] ?? 0;
        expect(firstY).toBeGreaterThanOrEqual(0);
        expect(lastY).toBeLessThanOrEqual(viewport.height);
        const clip = {
          x: Math.floor(firstX),
          y: Math.floor(firstY),
          width: Math.ceil(lastX) - Math.floor(firstX),
          height: Math.ceil(lastY) - Math.floor(firstY),
        };
        const columns = pixelIntervals(xs, clip.x, clip.width * scale, scale);
        const rows = pixelIntervals(ys, clip.y, clip.height * scale, scale);

        const capture = async (look: {
          readonly text: string;
          readonly weight: string;
          readonly showSum: boolean;
          readonly showNotes: boolean;
        }) => {
          await paintBoard(page, look);
          const image = decodePng(await page.screenshot({ clip, animations: "disabled" }));
          expect([image.width, image.height]).toEqual([clip.width * scale, clip.height * scale]);
          return image;
        };

        const first = SUM_TEXTS[0];
        const base = await capture({
          text: first,
          weight: "400",
          showSum: false,
          showNotes: false,
        });
        const sumShots = new Map<string, Image>();
        for (const text of SUM_TEXTS) {
          sumShots.set(
            text,
            await capture({ text, weight: "400", showSum: true, showNotes: false }),
          );
        }
        const noteShots = new Map<string, Image>();
        for (const weight of NOTE_WEIGHTS) {
          noteShots.set(
            weight,
            await capture({ text: first, weight, showSum: false, showNotes: true }),
          );
        }

        const byWeight = new Map(
          NOTE_WEIGHTS.map((weight) => [
            weight,
            { strict: [] as number[][], info: [] as number[][] },
          ]),
        );
        for (const text of SUM_TEXTS) {
          for (const weight of NOTE_WEIGHTS) {
            const sum = sumShots.get(text);
            const note = noteShots.get(weight);
            if (!sum || !note) throw new Error("Missing capture");
            const result = analyzeCase(
              {
                base,
                sum,
                note,
                both: await capture({ text, weight, showSum: true, showNotes: true }),
              },
              columns,
              rows,
              colors,
            );
            results.push({ width: viewport.width, result });
            measured++;
            const strict = Array.from({ length: BOARD_CELLS }, (_, index) =>
              percentOf(result.strict, index),
            );
            const info = Array.from({ length: BOARD_CELLS }, (_, index) =>
              percentOf(result.info, index),
            );
            byWeight.get(weight)?.strict.push(strict);
            byWeight.get(weight)?.info.push(info);
            const worst = worstOf(strict);
            const covered = strict.flatMap((_, index) =>
              (result.strict.covered[index] ?? 0) > 0
                ? [
                    `${cellName(index)}:${String(result.strict.covered[index])}/${String(result.strict.ink[index])}`,
                  ]
                : [],
            );
            // Cada caso se registra al terminarlo: los datos se conservan si la prueba agota su plazo.
            console.log(
              `T-42.20 case ${String(firstCase + measured)} of ${String(TOTAL_CASES)}: width ${String(viewport.width)}, scale ${String(scale)}, sum ${text}, weight ${weight}; max ${worst.max.toFixed(2)} % at ${worst.cells.join(",")}; covered ${covered.join(" ") || "none"}; min ink ${String(Math.min(...result.strict.ink))}, outside ${String(result.outsideInk)}, recount gap ${String(result.recountGap)}, differs from both ${String(result.differsFromBoth)}, no valid channel ${String(result.noValidChannel)}`,
            );
          }
        }

        for (const weight of NOTE_WEIGHTS) {
          const cases = byWeight.get(weight);
          if (!cases) throw new Error("Missing weight");
          const perCell = (values: readonly (readonly number[])[]) =>
            Array.from({ length: BOARD_CELLS }, (_, index) =>
              Math.max(...values.map((value) => value[index] ?? 0)),
            );
          const strict = perCell(cases.strict);
          const worst = worstOf(strict);
          const worstInfo = worstOf(perCell(cases.info));
          const worstSum = SUM_TEXTS.filter((_, position) =>
            (cases.strict[position] ?? []).some((value) => value === worst.max),
          );
          const grid = Array.from({ length: BOARD_SIZE }, (_, row) =>
            strict
              .slice(row * BOARD_SIZE, (row + 1) * BOARD_SIZE)
              .map((value) => value.toFixed(2).padStart(5))
              .join(" "),
          );
          console.log(
            `T-42.20 summary: width ${String(viewport.width)}, scale ${String(scale)}, weight ${weight}: max ${worst.max.toFixed(2)} % at ${worst.cells.join(",")}, sum ${worstSum.join(",")}; information only, coverage ${String(INFO_COVERAGE)}: max ${worstInfo.max.toFixed(2)} % at ${worstInfo.cells.join(",")}\n${grid.join("\n")}`,
          );
        }
      }
      console.log(`T-42.20 cases measured: ${String(measured)} of 20 in this test`);

      // Solo después de medir todos los casos.
      const worstAt = (width: number) =>
        Math.max(
          ...results
            .filter((entry) => entry.width === width)
            .flatMap((entry) =>
              Array.from({ length: BOARD_CELLS }, (_, index) =>
                percentOf(entry.result.strict, index),
              ),
            ),
        );
      expect.soft(measured).toBe(20);
      for (const { result } of results) {
        expect.soft(Math.min(...result.strict.ink)).toBeGreaterThan(100);
        expect.soft(result.outsideInk).toBe(0);
        expect.soft(result.recountGap).toBe(0);
        expect.soft(result.differsFromBoth).toBe(0);
        expect
          .soft(result.noValidChannel, "a changed pixel has no channel with enough difference")
          .toBe(0);
      }
      const at360 = worstAt(PHONE.width);
      const at375 = worstAt(375);
      expect.soft(at360).toBeLessThanOrEqual(NOTE_OVER_SUM_LIMIT);
      // Negativa: a 360 px sí tapa algo, así que el detector ve el solape.
      expect.soft(at360).toBeGreaterThan(0);
      expect.soft(at375).toBe(0);

      await page.setViewportSize(PHONE);
      const raised = await page
        .locator(".sk-board[role=grid] .notes")
        .first()
        .evaluate((notes) => {
          const sum = document.createElement("span");
          sum.className = "sum";
          notes.parentElement?.append(sum);
          const result = [getComputedStyle(notes).zIndex, getComputedStyle(sum).zIndex];
          sum.remove();
          return result.map(Number);
        });
      expect.soft(raised[0] ?? 0).toBeGreaterThan(raised[1] ?? 0);
    } finally {
      await context.close();
    }
  });
}

test("T-42.19 the transitions live only in Ajustes, and respect reduced motion", async ({
  player,
  game,
}) => {
  const page = await player();
  await soloMatch(page, game);
  const duration = (selector: string, pseudo?: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element, after) => {
        const style = getComputedStyle(element, after);
        return (
          Math.max(...style.transitionDuration.split(",").map((value) => parseFloat(value))) * 1000
        );
      }, pseudo);
  const PANEL: readonly (readonly [string, string?])[] = [
    [".dialog.wide .switch"],
    [".dialog.wide .colorfield"],
    [".dialog.wide .switch .track"],
    [".dialog.wide .switch .track", "::after"],
    [".dialog.wide .swatch .dot"],
    [".dialog.wide .dactions .btn"],
    [".dialog.wide .dhead .btn"],
  ];
  const OUTSIDE = [
    ".sk-board[role=grid] .sk-gc",
    ".sk-board[role=grid] .cg",
    ".sk-board.preview .sk-gc",
    ".pg-nav .btn",
    ".pg-keys .key",
    ".pg-tools .btn",
  ];

  await openSettings(page);
  await expect(page.getByRole("dialog", { name: "Ajustes" })).toBeVisible();
  for (const [selector, pseudo] of PANEL) {
    const ms = await duration(selector, pseudo);
    expect(ms, `${selector}${pseudo ?? ""}`).toBeGreaterThanOrEqual(150);
    expect(ms, `${selector}${pseudo ?? ""}`).toBeLessThanOrEqual(200);
  }
  // Negativa: fuera del panel no hay transición.
  for (const selector of OUTSIDE) expect(await duration(selector), selector).toBe(0);

  // La transición corre de verdad y termina en su estado final.
  const toggle = page.getByRole("switch", { name: /^Aleatorio/ });
  await toggle.click();
  expect(
    await page.evaluate(() => document.getAnimations().some((a) => a instanceof CSSTransition)),
  ).toBe(true);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  await closeSettings(page);

  // Negativa: otro diálogo no se anima.
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(await duration(".dialog:not(.wide) .btn")).toBe(0);
  await page.getByRole("button", { name: "Quedarme" }).click();

  // Con el movimiento reducido no queda ninguna transición en el panel.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSettings(page);
  for (const [selector, pseudo] of PANEL) {
    expect(await duration(selector, pseudo), selector).toBeLessThan(1);
    // Ni siquiera se declara: la duración mínima es de la regla global de movimiento reducido.
    expect(
      await page
        .locator(selector)
        .first()
        .evaluate((element, after) => getComputedStyle(element, after).transitionProperty, pseudo),
      selector,
    ).toBe("all");
  }
  await page.getByRole("switch", { name: /^Aleatorio/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.getAnimations().filter((a) => a instanceof CSSTransition).length,
      ),
    )
    .toBe(0);
});

test("T-44.4 bold uses the real weight of the font", async ({ player, game }) => {
  const page = await player();
  await soloMatch(page, game);
  const result = await page.evaluate(async () => {
    await document.fonts.ready;
    const measure = (family: string, weight: number) => {
      const probe = document.createElement("span");
      probe.textContent = "HAMBURGEFONSTIV";
      probe.style.cssText = `position:absolute;visibility:hidden;font-size:64px;font-family:"${family}";font-weight:${String(weight)};font-feature-settings:normal`;
      document.body.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    };
    await document.fonts.load('800 64px "Inter"', "HAMBURGEFONSTIV");
    // Control: con el rango anterior, 800 no da un peso real.
    const capped = new FontFace("InterCapped", 'url("/fonts/inter-latin.woff2")', {
      weight: "400 600",
    });
    await capped.load();
    document.fonts.add(capped);
    const inter = [...document.fonts].filter((face) => face.family.replaceAll('"', "") === "Inter");
    return {
      ranges: inter.map((face) => face.weight),
      w600: measure("Inter", 600),
      w800: measure("Inter", 800),
      capped600: measure("InterCapped", 600),
      capped800: measure("InterCapped", 800),
    };
  });
  expect(new Set(result.ranges)).toEqual(new Set(["400 800"]));
  expect(result.w800).toBeGreaterThan(result.w600);
  // Sin el eje hasta 800 no cambia el ancho: la diferencia de arriba es del peso real.
  expect(result.capped800).toBe(result.capped600);
});

test("the wider range of Inter changes no other text: nothing but the bold notes goes above 600", async ({
  player,
  game,
}) => {
  const page = await player();
  const heavy = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((element) => {
          const own = [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
          );
          if (!own || element.closest(".n.strong")) return false;
          return Number(getComputedStyle(element).fontWeight) > 600;
        })
        .map((element) => `${element.tagName}.${element.className}: ${element.textContent}`),
    );
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await heavy()).toEqual([]);

  await page.goto("/#/entrar");
  await expect(page.getByLabel("Tu apodo")).toBeVisible();
  expect(await heavy()).toEqual([]);

  const code = await createRoom(page, "Inés");
  expect(await heavy()).toEqual([]);
  await openSettings(page);
  expect(await heavy()).toEqual([]);
  await closeSettings(page);

  await start(page, [page]);
  const empty = emptyCells(game, code);
  const solution = matchOf(game, code).solution;
  await place(page, at(empty, 0), solution[at(empty, 0)] ?? 0);
  await expect(cell(page, at(empty, 0))).toHaveAttribute("aria-label", /resuelta/);
  await setMode(page, "Notas");
  await writeNote(page, at(empty, 1), solution[at(empty, 0)] ?? 0, "Grupal");
  await cell(page, at(empty, 0)).click();
  await expect(page.locator(".sk-board[role=grid] .n.strong")).toHaveCount(1);
  expect(await heavy()).toEqual([]);
  await setMode(page, "Número");

  // Tres errores: fin de la partida y Resultados.
  for (const index of [2, 3, 4]) {
    await place(page, at(empty, index), wrongDigit(solution, at(empty, index)));
    await expect(page.locator(".sk-gc.err")).toHaveCount(1);
    await expect(page.locator(".sk-gc.err")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Ver resultados" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await heavy()).toEqual([]);
});
