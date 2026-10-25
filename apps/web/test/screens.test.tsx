// F10e: Inicio, Entrar o crear, Lobby, Resultados y Ayuda (design/pantallas.md §1.1–1.6), con las
// rutas por hash y «Compartir» (plan de F10). El transporte es falso: la prueba hace de servidor.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PublicPlayer, ServerEnvelope } from "@sudoku-killer/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Screens } from "../src/App.tsx";
import type { ShareApi } from "../src/components/share.ts";
import { GameClient } from "../src/game/client.ts";
import { memoryPrefs } from "../src/game/prefs.ts";
import { memorySession, type SessionStore } from "../src/game/session.ts";
import { navigate, parseRoute, roomLink, routeHash } from "../src/routes.ts";
import { ME, TOMAS, fakeTransport, player, testPuzzle, type FakeTransport } from "./helpers/ui.tsx";

const CODE = "HPQ6NZ";
const TOKEN = "ficha-secreta-de-ines";

beforeEach(() => {
  window.history.replaceState(null, "", "#/");
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#/");
});

interface Mounted {
  readonly client: GameClient;
  readonly transport: FakeTransport;
  readonly session: SessionStore;
}

function mount({
  hash = "#/",
  session = memorySession(),
  share = {},
}: { hash?: string; session?: SessionStore; share?: ShareApi } = {}): Mounted {
  window.history.replaceState(null, "", hash);
  const transport = fakeTransport();
  const client = new GameClient({ transport, prefs: memoryPrefs(), session });
  render(<Screens client={client} share={share} />);
  return { client, transport, session };
}

function withToken(): SessionStore {
  const session = memorySession();
  session.saveToken(CODE, TOKEN);
  session.saveNickname("Inés");
  session.saveLastRoom(CODE);
  return session;
}

type Snapshot = Extract<ServerEnvelope, { type: "room.welcome" }>["payload"]["snapshot"];

function welcome(
  transport: FakeTransport,
  {
    me = ME,
    players = [ME],
    starterId = ME.id,
    state = "waiting",
    match = null,
  }: {
    me?: PublicPlayer;
    players?: PublicPlayer[];
    starterId?: string;
    state?: "waiting" | "running" | "finished";
    match?: Snapshot["match"];
  } = {},
): void {
  const entry = transport.sent
    .filter((m) => m.type === "room.create" || m.type === "room.join")
    .at(-1);
  transport.emit({
    type: "room.welcome",
    ...(entry ? { replyTo: entry.id } : {}),
    payload: {
      playerId: me.id,
      token: TOKEN,
      snapshot: {
        serverNow: 0,
        atSeq: null,
        room: { code: CODE, state, starterId, difficulty: "medium", players },
        match,
        you: { playerId: me.id, settings: { autoCleanPersonalNotes: true }, personalNotes: [] },
      },
    },
  });
}

const waiting = (p: PublicPlayer): PublicPlayer => ({ ...p, role: null });

function inLobby(options: Parameters<typeof welcome>[1] = {}): Mounted {
  const mounted = mount({ hash: "#/entrar" });
  fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
  fireEvent.click(screen.getByRole("button", { name: "Crear sala nueva" }));
  welcome(mounted.transport, options);
  return mounted;
}

function started(transport: FakeTransport, players: PublicPlayer[] = [ME, TOMAS]): void {
  transport.emit({
    type: "match.started",
    payload: { matchId: "m1", puzzle: testPuzzle(), startedAt: 1000, hintsLeft: 3, players },
  });
}

describe("F10e hash routes", () => {
  it("parse and print the four routes; the room link carries the code and never the token", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/")).toEqual({ name: "home" });
    expect(parseRoute("#/entrar")).toEqual({ name: "enter", code: null });
    expect(parseRoute("#/entrar/hpq6nz")).toEqual({ name: "enter", code: CODE });
    expect(parseRoute("#/sala/HPQ6NZ")).toEqual({ name: "room", code: CODE });
    expect(parseRoute("#/sala/HPQ0NZ")).toEqual({ name: "home" });
    expect(parseRoute("#/ayuda")).toEqual({ name: "help" });
    expect(parseRoute("#/otra")).toEqual({ name: "home" });
    expect(routeHash({ name: "room", code: CODE })).toBe("#/sala/HPQ6NZ");
    expect(roomLink(CODE, { origin: "https://sk.example", pathname: "/", search: "" })).toBe(
      "https://sk.example/#/sala/HPQ6NZ",
    );
  });
});

describe("F10e Inicio (pantallas.md §1.1)", () => {
  it("without a token: only «Entrar o crear sala», «Cómo se juega», the facts and the repository", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Un tablero, varias cabezas.",
    );
    expect(screen.getByRole("link", { name: "Entrar o crear sala" }).getAttribute("href")).toBe(
      "#/entrar",
    );
    expect(screen.queryByRole("link", { name: /Volver a la sala/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Cómo se juega" }).getAttribute("href")).toBe(
      "#/ayuda",
    );
    expect(screen.getByRole("link", { name: "Código fuente en GitHub" })).toBeDefined();
    expect(screen.getByText("Hasta 6")).toBeDefined();
    // Ajustes solo dentro de una sala (decisión 1).
    expect(screen.queryByRole("button", { name: "Ajustes" })).toBeNull();
  });

  it("with a token: «Volver a la sala» resumes with the token and opens the room's screen", () => {
    const { transport } = mount({ session: withToken() });
    const back = screen.getByRole("link", { name: `Volver a la sala ${CODE}` });
    expect(back.getAttribute("href")).toBe(`#/sala/${CODE}`);
    expect(screen.getByText(/Recuperas tus vidas/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Entrar o crear otra sala" })).toBeDefined();
    act(() => {
      navigate({ name: "room", code: CODE });
    });
    expect(transport.last("room.join")?.payload).toEqual({
      code: CODE,
      nickname: "Inés",
      token: TOKEN,
    });
    welcome(transport, { players: [waiting(ME)] });
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
  });

  it("a deleted room: the notice on Inicio, the token is dropped and only «Entrar o crear sala» stays", () => {
    const session = withToken();
    const { transport } = mount({ hash: `#/sala/${CODE}`, session });
    const join = transport.last("room.join");
    transport.emit({
      type: "error",
      ...(join ? { replyTo: join.id } : {}),
      payload: { code: "room.not_found" },
    });
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("status").textContent).toBe(
      `La sala ${CODE} ya no existe. Las salas se borran tras 2 minutos sin nadie conectado.`,
    );
    expect(session.token(CODE)).toBeNull();
    expect(screen.getByRole("link", { name: "Entrar o crear sala" })).toBeDefined();
    expect(transport.sent.filter((m) => m.type === "room.join")).toHaveLength(1);
  });
});

describe("F10e the room link (#/sala/CODIGO)", () => {
  it("with the token saved, reloading resumes the session by itself", () => {
    const { transport } = mount({ hash: `#/sala/${CODE}`, session: withToken() });
    expect(transport.last("room.join")?.payload).toMatchObject({ code: CODE, token: TOKEN });
    expect(screen.getByRole("button", { name: /Entrando/ })).toBeDefined();
    welcome(transport, { players: [waiting(ME)] });
    expect(window.location.hash).toBe(`#/sala/${CODE}`);
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
  });

  it("without a token, Entrar opens with the code", () => {
    const { transport } = mount({ hash: `#/sala/${CODE}` });
    expect(transport.last("room.join")).toBeUndefined();
    expect(window.location.hash).toBe(`#/entrar/${CODE}`);
    expect(screen.getByLabelText<HTMLInputElement>("Código de la sala").value).toBe(CODE);
  });

  it("going back from the room closes the connection; the seat stays reserved (no room.leave)", () => {
    const { client, transport } = inLobby({ players: [waiting(ME)] });
    expect(window.location.hash).toBe(`#/sala/${CODE}`);
    act(() => {
      navigate({ name: "home" });
    });
    expect(client.getState().phase).toBe("home");
    expect(transport.last("room.leave")).toBeUndefined();
    expect(screen.getByRole("link", { name: `Volver a la sala ${CODE}` })).toBeDefined();
  });
});

describe("F10e Entrar o crear (pantallas.md §1.2)", () => {
  it("rejects characters outside the alphabet with an inline note and writes in upper case", () => {
    mount({ hash: "#/entrar" });
    const code = screen.getByLabelText<HTMLInputElement>("Código de la sala");
    fireEvent.change(code, { target: { value: "hpq6o" } });
    expect(code.value).toBe("HPQ6");
    expect(screen.getByText("La «O» no se usa en los códigos y no se añadió.")).toBeDefined();
  });

  it("checks the nickname and the complete code before sending", () => {
    const { transport } = mount({ hash: "#/entrar" });
    fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "I" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    // Los dos errores a la vez; el foco va al primero.
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "El apodo tiene que tener entre 2 y 16 caracteres.",
      "El código tiene 6 caracteres.",
    ]);
    expect(document.activeElement).toBe(screen.getByLabelText("Tu apodo"));
    fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
    fireEvent.change(screen.getByLabelText("Código de la sala"), { target: { value: "HPQ" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(screen.getByRole("alert").textContent).toBe("El código tiene 6 caracteres.");
    expect(transport.sent.filter((m) => m.type === "room.join")).toHaveLength(0);
  });

  it("a room that does not exist is a code error; a full room, an alert; the data stay", () => {
    const { transport } = mount({ hash: "#/entrar" });
    fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
    fireEvent.change(screen.getByLabelText("Código de la sala"), { target: { value: "QW4RTP" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    let join = transport.last("room.join");
    transport.emit({
      type: "error",
      ...(join ? { replyTo: join.id } : {}),
      payload: { code: "room.not_found" },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "No hay ninguna sala con el código QW4RTP.",
    );
    expect(screen.getByLabelText("Código de la sala").getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(screen.getByLabelText("Código de la sala"), { target: { value: CODE } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    join = transport.last("room.join");
    transport.emit({
      type: "error",
      ...(join ? { replyTo: join.id } : {}),
      payload: { code: "room.full" },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      `Sala llena. La sala ${CODE} tiene sus 6 asientos ocupados.`,
    );
    expect(screen.getByLabelText<HTMLInputElement>("Tu apodo").value).toBe("Inés");
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("while entering, the fields are inactive and the form is busy", () => {
    mount({ hash: "#/entrar" });
    fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
    fireEvent.change(screen.getByLabelText("Código de la sala"), { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(screen.getByLabelText<HTMLInputElement>("Tu apodo").disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Entrando/ })).toBeDefined();
    expect(document.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText(`Entrando en la sala ${CODE}…`)).toBeDefined();
  });
});

describe("F10e Lobby (pantallas.md §1.3)", () => {
  it("whoever starts picks the difficulty and starts; the code reads letter by letter", () => {
    const { transport } = inLobby({ players: [waiting(ME), waiting(TOMAS)] });
    expect(screen.getByText(CODE).getAttribute("aria-label")).toBe("H P Q 6 N Z");
    expect(screen.getByText("2 de 6")).toBeDefined();
    expect(screen.getAllByText("Asiento libre")).toHaveLength(4);
    expect(screen.getByText("Inicia la partida")).toBeDefined();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Media/ }).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Difícil/ }));
    expect(transport.last("room.set_difficulty")?.payload).toEqual({ difficulty: "hard" });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar partida" }));
    expect(transport.last("match.start")).toBeDefined();
    expect(screen.getByRole("button", { name: /Iniciando/ })).toBeDefined();
    started(transport, [ME, TOMAS]);
    expect(screen.getByRole("grid", { name: "Tablero" })).toBeDefined();
    expect(window.location.hash).toBe(`#/sala/${CODE}`);
  });

  it("each difficulty says how many initial numbers it has, from the version 2 equivalence", () => {
    inLobby({ players: [waiting(ME)] });
    const note = (name: RegExp): string | null =>
      screen.getByRole("radio", { name }).closest("label")?.querySelector(".rnote")?.textContent ??
      null;
    expect(note(/Fácil/)).toBe("30 números iniciales");
    expect(note(/Media/)).toBe("22 números iniciales");
    expect(note(/Difícil/)).toBe("10 números iniciales");
    expect(note(/Experto/)).toBe("Sin números iniciales");
  });

  it("the others see the difficulty and wait; they follow it live and see the handover", () => {
    const tomas = waiting(TOMAS);
    const { transport } = inLobby({
      me: tomas,
      players: [waiting(ME), tomas],
      starterId: ME.id,
    });
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("La elige Inés, que inicia la partida.")).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("Esperando a que Inés inicie la partida.");
    transport.emit({ type: "room.difficulty_set", payload: { difficulty: "expert" } });
    expect(screen.getByText("Experto")).toBeDefined();
    transport.emit({
      type: "room.player_connection",
      payload: { playerId: ME.id, connection: "left", seat: null },
    });
    transport.emit({ type: "room.starter_changed", payload: { playerId: TOMAS.id } });
    expect(screen.getByText("Inés salió de la sala. Ahora inicias tú la partida.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Iniciar partida" })).toBeDefined();
  });

  it("a full room says so, and the disconnected keep their seat with a tag", () => {
    const players = Array.from({ length: 6 }, (_, i) =>
      waiting(i === 0 ? ME : player(`p${String(i)}`, `Jugador ${String(i)}`, i)),
    );
    const off = players[3];
    if (off) players[3] = { ...off, connection: "disconnected" };
    inLobby({ players });
    expect(screen.queryByText("Asiento libre")).toBeNull();
    expect(
      screen.getByText("Sala llena: nadie más puede entrar hasta que se libere un asiento."),
    ).toBeDefined();
    expect(screen.getByText("Desconectado")).toBeDefined();
  });

  it("«Copiar código» copies the code and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const mounted = mount({ hash: "#/entrar", share: { writeText } });
    fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear sala nueva" }));
    welcome(mounted.transport, { players: [waiting(ME)] });
    fireEvent.click(screen.getByRole("button", { name: "Copiar código" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Código copiado" })).toBeDefined();
    });
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(screen.getByText(`Código ${CODE} copiado`)).toBeDefined();
  });

  it("«Compartir» opens the system sheet with the room link, never the token", async () => {
    const shared = vi.fn<(data: ShareData) => Promise<void>>(() => Promise.resolve());
    const mounted = mount({ hash: "#/entrar", share: { share: shared } });
    fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear sala nueva" }));
    welcome(mounted.transport, { players: [waiting(ME)] });
    fireEvent.click(screen.getByRole("button", { name: "Compartir" }));
    await waitFor(() => {
      expect(shared).toHaveBeenCalledTimes(1);
    });
    const data = shared.mock.calls[0]?.[0];
    expect(data?.url).toBe(`${window.location.origin}${window.location.pathname}#/sala/${CODE}`);
    expect(JSON.stringify(data)).not.toContain(TOKEN);
  });

  it("without the sheet the link is copied; without a clipboard, a dialog shows it selected", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    let mounted = mount({ hash: "#/entrar", share: { writeText } });
    fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear sala nueva" }));
    welcome(mounted.transport, { players: [waiting(ME)] });
    fireEvent.click(screen.getByRole("button", { name: "Compartir" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Enlace copiado" })).toBeDefined();
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#\/sala\/HPQ6NZ$/));
    cleanup();

    mounted = mount({ hash: "#/entrar", share: {} });
    fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear sala nueva" }));
    welcome(mounted.transport, { players: [waiting(ME)] });
    fireEvent.click(screen.getByRole("button", { name: "Compartir" }));
    const dialog = await screen.findByRole("dialog", { name: "Enlace a la sala" });
    const input = within(dialog).getByLabelText<HTMLInputElement>("Enlace");
    expect(input.value).toMatch(/#\/sala\/HPQ6NZ$/);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("«Salir de la sala» confirms, sends room.leave and goes to Inicio", () => {
    const { transport } = inLobby({ players: [waiting(ME), waiting(TOMAS)] });
    fireEvent.click(screen.getByRole("button", { name: "Salir de la sala" }));
    const dialog = screen.getByRole("alertdialog", { name: "¿Salir de la sala?" });
    expect(dialog.textContent).toContain("El derecho de iniciar pasará a Tomás");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salir de la sala" }));
    expect(transport.last("room.leave")).toBeDefined();
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Un tablero, varias cabezas.",
    );
  });
});

function ended(transport: FakeTransport): void {
  transport.emit({
    type: "match.ended",
    seq: 10,
    payload: {
      result: "victory",
      endedAt: 1000 + 31 * 60_000 + 7000,
      ranking: [
        {
          playerId: "p-val",
          nickname: "Valeria",
          score: 1020,
          mistakes: 1,
          scoreReachedAt: 5,
          position: 1,
        },
        {
          playerId: ME.id,
          nickname: "Inés",
          score: 865,
          mistakes: 2,
          scoreReachedAt: 9,
          position: 2,
        },
        {
          playerId: TOMAS.id,
          nickname: "Tomás",
          score: 865,
          mistakes: 2,
          scoreReachedAt: 9,
          position: 2,
        },
        {
          playerId: "p-rafa",
          nickname: "Rafa",
          score: 160,
          mistakes: 1,
          scoreReachedAt: 3,
          position: 4,
        },
      ],
    },
  } as never);
}

describe("F10e Resultados (pantallas.md §1.5)", () => {
  const valeria = player("p-val", "Valeria", 2);

  it("only with «Ver resultados»; ranking with ties and «Salió»; whoever starts goes back to the lobby", () => {
    const { transport } = inLobby({ players: [waiting(ME), waiting(TOMAS), waiting(valeria)] });
    started(transport, [ME, TOMAS, valeria]);
    ended(transport);
    // El paso a Resultados nunca es automático (plan de F10).
    expect(screen.getByRole("grid", { name: "Tablero" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Ver resultados" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tablero resuelto.");
    expect(screen.getByText("El equipo completó las 81 celdas.")).toBeDefined();
    expect(screen.getByText("31:07")).toBeDefined();
    expect(screen.getByText("0 de 3")).toBeDefined();
    const rows = within(screen.getByRole("table", { name: "Ranking de la partida" })).getAllByRole(
      "row",
    );
    expect(rows).toHaveLength(5);
    expect(rows[2]?.textContent).toContain("Puesto 2, empate");
    expect(rows[2]?.textContent).toContain("Inés · tú");
    expect(rows[4]?.textContent).toContain("Salió");
    expect(
      screen.getByText(
        "Inés y Tomás comparten el 2.º puesto: mismos puntos, mismos errores y alcanzaron esa puntuación a la vez.",
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Volver al lobby" }));
    const reset = transport.last("room.reset");
    expect(reset).toBeDefined();
    transport.emit({
      type: "room.state_changed",
      ...(reset ? { replyTo: reset.id } : {}),
      payload: { state: "waiting" },
    });
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
    expect(screen.queryByRole("status", { name: /volvió al lobby/ })).toBeNull();
  });

  it("the others wait; when the starter goes back, everyone moves to the lobby with a notice", () => {
    const tomas = waiting(TOMAS);
    const { transport } = inLobby({ me: tomas, players: [waiting(ME), tomas], starterId: ME.id });
    started(transport, [ME, TOMAS]);
    ended(transport);
    fireEvent.click(screen.getByRole("button", { name: "Ver resultados" }));
    expect(screen.queryByRole("button", { name: "Volver al lobby" })).toBeNull();
    expect(screen.getByText("Esperando a que Inés vuelva al lobby.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salir de la sala" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("no estarás en la próxima partida");
    expect(dialog.textContent).not.toContain("El derecho de iniciar");
    fireEvent.click(within(dialog).getByRole("button", { name: "Quedarme" }));
    transport.emit({ type: "room.state_changed", payload: { state: "waiting" } });
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
    expect(screen.getByText("Inés volvió al lobby para preparar otra partida.")).toBeDefined();
  });

  it("those still on the board also move to the lobby when the starter goes back", () => {
    const tomas = waiting(TOMAS);
    const { transport } = inLobby({ me: tomas, players: [waiting(ME), tomas], starterId: ME.id });
    started(transport, [ME, TOMAS]);
    ended(transport);
    transport.emit({ type: "room.state_changed", payload: { state: "waiting" } });
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
  });
});

describe("F10h a defeat says its cause, live and after reloading (SPEC 1.8)", () => {
  const ranking = [
    { playerId: ME.id, nickname: "Inés", score: 120, mistakes: 3, scoreReachedAt: 7, position: 1 },
    {
      playerId: TOMAS.id,
      nickname: "Tomás",
      score: 40,
      mistakes: 1,
      scoreReachedAt: 4,
      position: 2,
    },
  ];
  const texts = {
    lives: [
      "Se acabaron las vidas.",
      "Todos los jugadores perdieron sus 3 vidas antes de completar el tablero.",
    ],
    gone: [
      "La partida quedó sin jugadores.",
      "Todos los jugadores salieron o estuvieron desconectados más de 2 minutos.",
    ],
    mixed: [
      "La partida quedó sin jugadores activos.",
      "Los jugadores que quedaban perdieron sus vidas o salieron de la partida.",
    ],
  } as const;

  function expectResults(cause: keyof typeof texts): void {
    const [title, lead] = texts[cause];
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
    expect(screen.getByText(lead)).toBeDefined();
    expect(screen.queryByText("Partida sin terminar.")).toBeNull();
  }

  for (const cause of ["lives", "gone", "mixed"] as const) {
    it(`live: ${cause}`, () => {
      const { transport } = inLobby({ players: [waiting(ME), waiting(TOMAS)] });
      started(transport, [ME, TOMAS]);
      transport.emit({
        type: "match.ended",
        seq: 10,
        payload: { result: "defeat", defeatCause: cause, endedAt: 1000 + 60_000, ranking },
      });
      // La franja del tablero ya dice la causa, con el mismo titular que Resultados.
      expect(screen.getByText(`La partida terminó. ${texts[cause][0]}`)).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Ver resultados" }));
      expectResults(cause);
    });
  }

  it("after reloading: the snapshot brings the cause, though those who left were purged", () => {
    // Tomás salió y la sala lo purgó al terminar: el snapshot solo trae a Inés (0 vidas), pero el
    // ranking lo sigue mostrando, y la causa no se puede deducir de lo que queda (mezcla).
    const { transport } = mount({ hash: `#/sala/${CODE}`, session: withToken() });
    welcome(transport, {
      state: "finished",
      players: [{ ...ME, lives: 0, role: "spectator" }],
      match: {
        id: "m1",
        puzzle: testPuzzle(),
        startedAt: 1000,
        endedAt: 1000 + 60_000,
        result: "defeat",
        defeatCause: "mixed",
        hintsLeft: 3,
        locked: [],
        groupNotes: [],
        ranking,
      },
    });
    expectResults("mixed");
    const rows = within(screen.getByRole("table", { name: "Ranking de la partida" })).getAllByRole(
      "row",
    );
    expect(rows[2]?.textContent).toContain("Salió");
  });
});

describe("F10h R-38 activity after a reconnection", () => {
  const GAP = "La actividad anterior a la reconexión no está disponible.";
  const puzzle = testPuzzle();
  const givens = new Set(puzzle.givens.map((g) => g.cell));
  const free = [...Array(puzzle.size * puzzle.size).keys()].filter((cell) => !givens.has(cell));

  function reload(
    locked: NonNullable<Snapshot["match"]>["locked"],
    me: PublicPlayer = ME,
  ): FakeTransport {
    const { transport } = mount({ hash: `#/sala/${CODE}`, session: withToken() });
    welcome(transport, {
      state: "running",
      players: [me, TOMAS],
      match: {
        id: "m1",
        puzzle,
        startedAt: 1000,
        endedAt: null,
        result: null,
        hintsLeft: 3,
        locked,
        groupNotes: [],
        ranking: null,
      },
    });
    return transport;
  }

  function history(): string[] {
    fireEvent.click(screen.getByRole("button", { name: "Ver actividad" }));
    const dialog = screen.getByRole("dialog", { name: "Actividad" });
    const rows = within(dialog)
      .getAllByRole("listitem")
      .map((row) => row.querySelector(".atext")?.textContent ?? row.textContent);
    fireEvent.keyDown(dialog, { key: "Escape" });
    return rows;
  }

  it("T-38.1 with earlier plays: the line and the dialog show the notice, and new plays come after it", () => {
    const [solved = 0, next = 1] = free;
    // Inés recarga después de haber sumado puntos: no es una llegada nueva.
    const transport = reload([{ cell: solved, value: 4, source: "solved", by: ME.id }], {
      ...ME,
      score: 10,
    });
    expect(screen.queryByText("Todavía no hay jugadas.")).toBeNull();
    expect(screen.getByText(GAP, { selector: ".stxt" })).toBeDefined();
    expect(history()).toEqual([GAP]);
    transport.emit({
      type: "cell.solved",
      seq: 20,
      payload: { cell: next, value: 3, by: TOMAS.id, points: 10, score: 20, bonuses: [] },
    });
    const rows = history();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^Tomás · acierto en /);
    expect(rows[1]).toBe(GAP);
  });

  it("T-38.1 without plays: no notice; the history keeps what it had (here, only the arrival)", () => {
    reload([]);
    expect(screen.queryByText(GAP)).toBeNull();
    expect(history()).toEqual([
      "Entraste en una partida en curso: empiezas con 3 vidas y 0 puntos. Las notas grupales ya están a la vista.",
    ]);
  });
});

describe("F10e Ayuda (pantallas.md §1.6)", () => {
  it("from Inicio: no Ajustes; «Volver» goes back", () => {
    mount();
    act(() => {
      navigate({ name: "help" });
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cómo se juega");
    expect(screen.getByRole("link", { name: "Ayuda" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "Ajustes" })).toBeNull();
    for (const title of ["Reglas del killer", "Capas de notas", "Desconexión", "Atajos de teclado"])
      expect(screen.getByRole("heading", { name: title })).toBeDefined();
    expect(screen.getAllByRole("navigation", { name: "En esta página" }).length).toBeGreaterThan(0);
  });

  it("from a room: Ajustes in the header, and the room stays open", () => {
    const { client } = inLobby({ players: [waiting(ME)] });
    act(() => {
      navigate({ name: "help" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(screen.getByRole("dialog", { name: "Ajustes" })).toBeDefined();
    const settings = screen.getByRole("dialog", { name: "Ajustes" });
    fireEvent.keyDown(settings, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Ajustes" })).toBeNull();
    expect(client.getState().phase).toBe("lobby");
    act(() => {
      navigate({ name: "room", code: CODE });
    });
    expect(screen.getByRole("heading", { name: "Sala de espera" })).toBeDefined();
    expect(client.getState().phase).toBe("lobby");
  });
});
