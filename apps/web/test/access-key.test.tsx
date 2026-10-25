// Clave de acceso del grupo en el cliente (F12, R-39): el cierre 4003 lleva a «Clave del grupo»; la
// clave escrita se guarda normalizada y se repite la entrada; una guardada que no vale se olvida; y
// el enlace de invitación (`#k=`) guarda la clave y la saca de la URL.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function mount(session: SessionStore = memorySession()): {
  client: GameClient;
  transport: FakeTransport;
  session: SessionStore;
} {
  const transport = fakeTransport();
  const client = new GameClient({ transport, prefs: memoryPrefs(), session });
  render(<Screens client={client} />);
  return { client, transport, session };
}

function create(nickname: string): void {
  fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: nickname } });
  fireEvent.click(screen.getByRole("button", { name: "Crear sala nueva" }));
}

describe("T-39.4 the access key screen (R-39)", () => {
  it("4003 without a stored key asks for it; a short key is refused; a valid one is stored and the entry repeats", () => {
    const { transport, session } = mount();
    create("Inés");
    transport.setStatus("denied");
    expect(screen.getByRole("heading", { name: "Clave del grupo" })).toBeDefined();
    expect(screen.getByText(/Este juego es privado/)).toBeDefined();

    fireEvent.change(screen.getByLabelText("Clave"), { target: { value: "corta" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert").textContent).toMatch(/entre 12 y 64/);
    expect(session.accessKey()).toBeNull();

    fireEvent.change(screen.getByLabelText("Clave"), {
      target: { value: "abcd-efgh-jkmn-pqrs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(session.accessKey()).toBe("ABCDEFGHJKMNPQRS");
    expect(screen.queryByRole("heading", { name: "Clave del grupo" })).toBeNull();
    const before = transport.sent.filter((m) => m.type === "room.create").length;
    transport.setStatus("open");
    const creates = transport.sent.filter((m) => m.type === "room.create");
    expect(creates).toHaveLength(before + 1);
    expect(creates.at(-1)?.payload).toEqual({ nickname: "Inés" });
  });

  it("4003 with a stored key says it no longer works and forgets it; «Volver al inicio» leaves", () => {
    const session = memorySession();
    session.saveAccessKey("OLDKEYOLDKEYOLD");
    const { transport } = mount(session);
    create("Inés");
    transport.setStatus("denied");
    expect(screen.getByText(/ya no vale/)).toBeDefined();
    expect(session.accessKey()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Volver al inicio" }));
    expect(screen.queryByRole("heading", { name: "Clave del grupo" })).toBeNull();
    expect(window.location.hash).toBe("#/");
  });
});

describe("T-39.5 the invitation link (#k=)", () => {
  it("stores the key and replaces the URL with #/, also for a key that is not valid", () => {
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
