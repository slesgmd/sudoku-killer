// E2E de los colores personales y la negrita contra el servidor real, en Chromium (SPEC, R-42 y R-44):
// - el color se ve en el tablero, no cambia para otro jugador y no sale ningún mensaje (T-42.6);
// - personal, grupal y ambas se distinguen también con el mismo color (T-42.7);
// - los estados del tablero no dependen del color elegido (T-42.8);
// - el panel cabe a 360, 640 × 360 y 1280 px (T-42.9), y sus radios funcionan con el teclado (T-42.4);
// - la negrita no mueve las notas (T-44.3) y usa el peso real de la fuente (T-44.4).
import type { Page } from "@playwright/test";
import { cell, createRoom, expect, joinRoom, test, type GameServer } from "./fixtures.ts";
import { at, emptyCells, matchOf, place, start, wrongDigit } from "./game.ts";

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
    expect(p.thickness).toBe("1px");
    expect(g).toMatchObject({ color: groupColor, weight: "600", line: "none" });
    expect(gp).toMatchObject({ color: groupColor, weight: "600", line: "underline" });
    expect(gp.lineColor).toBe(personalColor);
    expect(gp.thickness).toBe(same ? "2px" : "1px");

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
      expect(pS.thickness).not.toBe(gpS.thickness);
    } else {
      expect(pS.color).not.toBe(gpS.color);
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

  const decoration = (index: number) =>
    jaula.nth(index).evaluate((input) => {
      const dot = input.nextElementSibling;
      if (!dot) throw new Error("No dot");
      return {
        ring: getComputedStyle(dot).boxShadow,
        mark: getComputedStyle(dot, "::after").content,
      };
    });
  const chosen = await decoration(1);
  expect(chosen.ring).not.toBe("none");
  expect(chosen.mark).not.toBe("none");
  const other = await decoration(2);
  expect(other.ring).toBe("none");
  expect(other.mark).toBe("none");
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

for (const viewport of [PHONE, DESKTOP]) {
  test(`T-44.3 bold does not move the notes at ${String(viewport.width)} px`, async ({
    player,
    game,
  }) => {
    const page = await player();
    await page.setViewportSize(viewport);
    const { empty, solution } = await soloMatch(page, game);
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

    const boxes = () =>
      page
        .locator(".sk-board[role=grid] [role=gridcell]")
        .nth(target)
        .locator(".n")
        .evaluateAll((items) =>
          items.map((item) => {
            const box = item.getBoundingClientRect();
            return [box.x, box.y, box.width, box.height];
          }),
        );
    const plain = await boxes();
    expect(plain).toHaveLength(9);

    await cell(page, placed).click();
    const strong = noteIn(page, target, ".n.gp.strong", digit);
    await expect(strong).toHaveCSS("font-weight", "800");
    expect(await boxes()).toEqual(plain);
  });
}

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
