// Clave de acceso del grupo en el cliente (R-39): sin clave o con una que dejó de valer, la
// comprobación por HTTP lleva a «Clave del grupo» (y, de respaldo, el cierre 4003); la clave escrita y
// la de la invitación (`#k=`) se comprueban con `POST /access` y solo se guardan si valen (T-39.14);
// una guardada que deja de valer se olvida con un aviso (T-39.15).
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Screens } from "../src/App.tsx";
import { GameClient } from "../src/game/client.ts";
import { memoryPrefs } from "../src/game/prefs.ts";
import { memorySession, type SessionStore } from "../src/game/session.ts";
import { invitationKey, takeInvitation } from "../src/routes.ts";
import { fakeTransport, type FakeTransport } from "./helpers/ui.tsx";

beforeEach(() => {
  window.history.replaceState(null, "", "#/entrar");
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#/");
});

const VALID = "ABCDEFGHJKMNPQRS";

/**
 * Un transporte falso con `POST /access`: `answer` decide el estado (por defecto, 204 solo para
 * `VALID`) y `checked` guarda las claves preguntadas.
 */
function mount(
  session: SessionStore = memorySession(),
  answer: (key: string) => number | null = (key) => (key === VALID ? 204 : 401),
): {
  client: GameClient;
  transport: FakeTransport;
  session: SessionStore;
  checked: string[];
  /** Retiene las respuestas de `POST /access` hasta `release`. */
  hold: () => void;
  release: () => void;
} {
  const transport = fakeTransport();
  const checked: string[] = [];
  let held: (() => void)[] = [];
  let hold = false;
  transport.checkAccess = (key) => {
    checked.push(key);
    const status = answer(key);
    if (!hold) return Promise.resolve(status);
    return new Promise((resolve) => {
      held.push(() => {
        resolve(status);
      });
    });
  };
  const client = new GameClient({ transport, prefs: memoryPrefs(), session });
  render(<Screens client={client} />);
  return {
    client,
    transport,
    session,
    checked,
    hold: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      const pending = held;
      held = [];
      for (const resolve of pending) resolve();
    },
  };
}

function create(nickname: string): void {
  fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: nickname } });
  fireEvent.click(screen.getByRole("button", { name: "Crear sala nueva" }));
}

function submit(key: string): void {
  fireEvent.change(screen.getByLabelText("Clave"), { target: { value: key } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar|Comprobando/ }));
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("T-39.4 the access key screen (R-39)", () => {
  it("denied without a stored key asks for it; a short key is refused without asking the server", () => {
    const { transport, session, checked } = mount();
    create("Inés");
    transport.setStatus("denied");
    expect(screen.getByRole("heading", { name: "Clave del grupo" })).toBeDefined();
    expect(screen.getByText(/Este juego es privado/)).toBeDefined();
    submit("corta");
    expect(screen.getByRole("alert").textContent).toMatch(/entre 12 y 64/);
    expect(session.accessKey()).toBeNull();
    expect(checked).toEqual([]);
  });

  it("«Volver al inicio» leaves", () => {
    const { transport } = mount();
    create("Inés");
    transport.setStatus("denied");
    fireEvent.click(screen.getByRole("button", { name: "Volver al inicio" }));
    expect(screen.queryByRole("heading", { name: "Clave del grupo" })).toBeNull();
    expect(window.location.hash).toBe("#/");
  });
});

describe("T-39.14 a typed key is checked with POST /access and stored only if it works", () => {
  it("204: the key is stored normalized and the entry repeats with the same data", async () => {
    const { transport, session, checked, hold, release } = mount();
    create("Inés");
    transport.setStatus("denied");
    hold();
    submit("abcd-efgh-jkmn-pqrs");
    // Mientras se espera la respuesta, nada se guarda y el botón lo dice.
    expect(checked).toEqual([VALID]);
    expect(screen.getByRole("button", { name: "Comprobando la clave…" })).toBeDefined();
    expect(session.accessKey()).toBeNull();
    release();
    await flush();
    expect(session.accessKey()).toBe(VALID);
    expect(screen.queryByRole("heading", { name: "Clave del grupo" })).toBeNull();
    const before = transport.sent.filter((m) => m.type === "room.create").length;
    transport.setStatus("open");
    const creates = transport.sent.filter((m) => m.type === "room.create");
    expect(creates).toHaveLength(before + 1);
    expect(creates.at(-1)?.payload).toEqual({ nickname: "Inés" });
  });

  it("401: stays on the screen saying the key does not work, and nothing is stored", async () => {
    const { transport, session } = mount();
    create("Inés");
    transport.setStatus("denied");
    submit("WXYZ-WXYZ-WXYZ-WXYZ");
    await flush();
    expect(screen.getByRole("alert").textContent).toMatch(/Esa clave no vale/);
    expect(screen.getByRole("heading", { name: "Clave del grupo" })).toBeDefined();
    expect(session.accessKey()).toBeNull();
    // Otra clave, la vigente, sí entra.
    submit(VALID);
    await flush();
    expect(session.accessKey()).toBe(VALID);
  });

  it("429: asks to wait, keeping the stored key; no answer: says it could not check", async () => {
    const session = memorySession();
    session.saveAccessKey("OLDKEYOLDKEYOLD");
    const locked = mount(session, () => 429);
    create("Inés");
    locked.transport.setStatus("locked");
    expect(screen.getByText(/Demasiados intentos/)).toBeDefined();
    expect(session.accessKey()).toBe("OLDKEYOLDKEYOLD");
    cleanup();

    const fresh = memorySession();
    const down = mount(fresh, (key) => (key === "DOWNDOWNDOWNDOWN" ? 503 : 429));
    create("Inés");
    down.transport.setStatus("denied");
    submit("DOWN-DOWN-DOWN-DOWN");
    await flush();
    expect(screen.getByRole("alert").textContent).toMatch(/No se pudo comprobar/);
    expect(fresh.accessKey()).toBeNull();
    submit("WXYZ-WXYZ-WXYZ-WXYZ");
    await flush();
    expect(screen.getByText(/Demasiados intentos/)).toBeDefined();
    expect(fresh.accessKey()).toBeNull();
  });

  it("the invitation key goes through the same check: stored with 204, asked for with 401", async () => {
    const good = mount();
    act(() => {
      good.client.acceptInvitation(VALID);
    });
    await flush();
    expect(good.checked).toEqual([VALID]);
    expect(good.session.accessKey()).toBe(VALID);
    expect(screen.queryByRole("heading", { name: "Clave del grupo" })).toBeNull();
    cleanup();

    const session = memorySession();
    session.saveAccessKey(VALID);
    const bad = mount(session);
    act(() => {
      bad.client.acceptInvitation("WXYZWXYZWXYZWXYZ");
    });
    await flush();
    expect(screen.getByRole("heading", { name: "Clave del grupo" })).toBeDefined();
    expect(screen.getByRole("alert").textContent).toMatch(/Esa clave no vale/);
    // La guardada antes no se toca: solo se guarda una clave que valió.
    expect(session.accessKey()).toBe(VALID);
  });
});

describe("T-39.15 a stored key that stops working", () => {
  it("denied with a stored key says it no longer works and forgets it", async () => {
    const session = memorySession();
    session.saveAccessKey("OLDKEYOLDKEYOLD");
    const { transport } = mount(session);
    create("Inés");
    transport.setStatus("denied");
    await waitFor(() => {
      expect(screen.getByText(/ya no vale/)).toBeDefined();
    });
    expect(session.accessKey()).toBeNull();
  });
});

describe("T-39.5 the invitation link (#k=)", () => {
  it("hands over the key and replaces the URL with #/, also for a key that is not valid", () => {
    const saved: string[] = [];
    const replaced: string[] = [];
    const history = {
      replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => {
        replaced.push(String(url));
      },
    };
    const location = { hash: "#k=abcd-EFGH-jkmn-PQRS", pathname: "/", search: "" };
    expect(takeInvitation(location, history, (key) => saved.push(key))).toBe(true);
    expect(saved).toEqual(["ABCDEFGHJKMNPQRS"]);
    expect(replaced).toEqual(["/#/"]);

    expect(
      takeInvitation({ ...location, hash: "#k=corta" }, history, (key) => saved.push(key)),
    ).toBe(true);
    expect(saved).toHaveLength(1);
    expect(replaced).toEqual(["/#/", "/#/"]);

    expect(takeInvitation({ ...location, hash: "#/sala/HPQ6NZ" }, history, () => undefined)).toBe(
      false,
    );
    expect(replaced).toHaveLength(2);
    expect(invitationKey("#k=%E0%A4%A")).toBeNull();
    expect(invitationKey("#k=%C3%91and%C3%BA%20en%20Lima%202026")).toBe("ÑANDÚENLIMA2026");
  });
});
