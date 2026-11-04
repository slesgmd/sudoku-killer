// Límites por IP en el cliente (SPEC R-40): la espera se muestra con una cuenta atrás, sin jerga y
// sin perder lo escrito; el transporte respeta el `Retry-After` y reintenta solo. Con el servidor
// abierto no aparece «Clave del grupo» (R-39, T-39.20 y T-39.21).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Screens } from "../src/App.tsx";
import { formatWait } from "../src/components/Countdown.tsx";
import { ENTRY_WAIT_DEFAULT_MS, GameClient } from "../src/game/client.ts";
import { memoryPrefs } from "../src/game/prefs.ts";
import { memorySession } from "../src/game/session.ts";
import { createWsTransport, httpEntryProbe, httpProbe } from "../src/transport/ws.ts";
import type { EntryKind } from "../src/transport/types.ts";
import { fakeTransport, type FakeTransport } from "./helpers/ui.tsx";

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "#/entrar");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "#/");
});

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
const JOIN = "Entrar";
const CREATE = "Crear sala nueva";
const JOIN_WAITING = "Entrar: disponible cuando termine la espera";

function mount(entryWait?: (kind: EntryKind) => Promise<number | null>): {
  transport: FakeTransport;
  client: GameClient;
} {
  const transport = fakeTransport();
  if (entryWait) Object.assign(transport, { entryWait });
  transport.setStatus("idle");
  const client = new GameClient({ transport, prefs: memoryPrefs(), session: memorySession() });
  render(<Screens client={client} />);
  fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
  return { transport, client };
}

function tryCode(transport: FakeTransport): void {
  fireEvent.change(screen.getByLabelText("Código de la sala"), { target: { value: "HPQ6NZ" } });
  fireEvent.click(screen.getByRole("button", { name: JOIN }));
  transport.setStatus("open");
}

function reject(transport: FakeTransport, type: "room.join" | "room.create"): void {
  const sent = transport.last(type);
  if (!sent) throw new Error("Nothing sent");
  act(() => {
    transport.emit({ type: "error", replyTo: sent.id, payload: { code: "rate_limited" } });
  });
}

describe("T-40.11 an entry refused by the limits per address", () => {
  it("shows a clear wait with a countdown from Retry-After, keeps what was typed, blocks only that button, and it ends", async () => {
    const asked: EntryKind[] = [];
    const { transport } = mount((kind) => {
      asked.push(kind);
      return Promise.resolve(300_000);
    });
    tryCode(transport);
    reject(transport, "room.join");
    await flush();
    expect(asked).toEqual(["join"]);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Demasiados intentos/);
    expect(alert.textContent).toMatch(/códigos que no existen/);
    expect(screen.getByRole("timer").textContent).toBe("5:00");
    // Sin jerga.
    expect(alert.textContent).not.toMatch(/429|rate|IP|Retry/);
    expect(screen.getByLabelText<HTMLInputElement>("Tu apodo").value).toBe("Inés");
    expect(screen.getByLabelText<HTMLInputElement>("Código de la sala").value).toBe("HPQ6NZ");
    // Entrar espera y no envía nada; crear sala sigue disponible.
    const before = transport.sent.length;
    const join = screen.getByRole("button", { name: JOIN_WAITING });
    expect(join.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(join);
    expect(transport.sent.length).toBe(before);
    expect(screen.getByRole("button", { name: CREATE }).getAttribute("aria-disabled")).toBeNull();

    advance(60_000);
    expect(screen.getByRole("timer").textContent).toBe("4:00");
    advance(240_000);
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: JOIN }).getAttribute("aria-disabled")).toBeNull();
  });

  it("creating has its own message and blocks only «Crear sala nueva»", async () => {
    const { transport } = mount(() => Promise.resolve(30_000));
    fireEvent.click(screen.getByRole("button", { name: CREATE }));
    transport.setStatus("open");
    reject(transport, "room.create");
    await flush();
    expect(screen.getByRole("alert").textContent).toMatch(/muchas salas seguidas/);
    expect(screen.getByRole("timer").textContent).toBe("0:30");
    expect(screen.getByRole("button", { name: JOIN }).getAttribute("aria-disabled")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Crear sala nueva: disponible cuando termine la espera" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("without an answer from the server (an older one, or no network) it waits the default", async () => {
    const { transport } = mount(() => Promise.resolve(null));
    tryCode(transport);
    reject(transport, "room.join");
    await flush();
    expect(screen.getByRole("timer").textContent).toBe(formatWait(ENTRY_WAIT_DEFAULT_MS / 1000));
  });

  it("negative check: other errors do not start a wait", async () => {
    const { transport } = mount(() => Promise.resolve(30_000));
    tryCode(transport);
    const sent = transport.last("room.join");
    act(() => {
      transport.emit({
        type: "error",
        replyTo: sent?.id ?? "",
        payload: { code: "room.not_found" },
      });
    });
    await flush();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByRole("button", { name: JOIN }).getAttribute("aria-disabled")).toBeNull();
  });
});

describe("T-40.12 too many connections from this network", () => {
  it("entering, it is not «Despertando el servidor…» nor «Clave del grupo»: it counts down and goes on by itself", () => {
    const { transport } = mount();
    fireEvent.click(screen.getByRole("button", { name: CREATE }));
    transport.setStatus("connecting");
    Object.assign(transport, { throttledUntil: Date.now() + 27_000 });
    transport.setStatus("throttled");
    expect(screen.getByText("Demasiadas conexiones desde tu red.")).toBeDefined();
    expect(screen.getByRole("timer").textContent).toBe("0:27");
    expect(screen.queryByText("Despertando el servidor…")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Clave del grupo" })).toBeNull();
    advance(5_000);
    expect(screen.queryByText("Despertando el servidor…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    transport.setStatus("open");
    expect(transport.last("room.create")?.payload).toEqual({ nickname: "Inés" });
    expect(screen.queryByRole("timer")).toBeNull();
  });
});

describe("T-40.10 the transport respects Retry-After", () => {
  class Socket {
    readyState = 0;
    onopen: ((event: unknown) => void) | null = null;
    onclose: ((event: { readonly code: number }) => void) | null = null;
    onmessage: ((event: { readonly data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    send(): void {
      // Nada.
    }
    close(): void {
      // Nada.
    }
    fail(): void {
      this.onclose?.({ code: 1006 });
    }
  }

  function throttled(answer: { status: number; waitMs: number | null } | null) {
    const sockets: Socket[] = [];
    const listeners = new Map<string, (event: Event) => void>();
    const transport = createWsTransport({
      url: "wss://example.test/ws",
      open: () => {
        const socket = new Socket();
        sockets.push(socket);
        return socket;
      },
      random: () => 0,
      window: null,
      document: {
        visibilityState: "visible",
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: () => undefined,
      },
      probe: () => Promise.resolve(answer),
    });
    return { transport, sockets, listeners };
  }

  it("503 with a wait leaves it throttled, without retrying before the wait, not even when coming back to the foreground", async () => {
    const { transport, sockets, listeners } = throttled({ status: 503, waitMs: 30_000 });
    transport.connect();
    expect(sockets).toHaveLength(1);
    sockets[0]?.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.status).toBe("throttled");
    expect(transport.throttledUntil).toBe(Date.now() + 30_000);
    await vi.advanceTimersByTimeAsync(29_999);
    listeners.get("visibilitychange")?.(new Event("visibilitychange"));
    transport.connect();
    transport.reconnect();
    expect(sockets).toHaveLength(1);
    expect(transport.status).toBe("throttled");
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
    expect(transport.status).toBe("connecting");
    expect(transport.throttledUntil).toBeNull();
    transport.close();
  });

  it("leaving during the wait cancels it", async () => {
    const { transport, sockets } = throttled({ status: 503, waitMs: 30_000 });
    transport.connect();
    sockets[0]?.fail();
    await vi.advanceTimersByTimeAsync(0);
    transport.disconnect();
    expect(transport.status).toBe("idle");
    expect(transport.throttledUntil).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    transport.close();
  });

  it("negative check: a 503 without a wait, as the caps answer, follows the usual backoff", async () => {
    const { transport, sockets } = throttled({ status: 503, waitMs: null });
    transport.connect();
    sockets[0]?.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.status).toBe("connecting");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets.length).toBeGreaterThan(1);
    transport.close();
  });

  it("httpProbe reads Retry-After, and httpEntryProbe asks GET /ws?entry= on the same host", async () => {
    const urls: string[] = [];
    const fetcher = ((input: RequestInfo | URL) => {
      urls.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(new Response(null, { status: 429, headers: { "retry-after": "27" } }));
    }) as typeof fetch;
    expect(await httpProbe("wss://sk.example/ws", fetcher)()).toEqual({
      status: 429,
      waitMs: 27_000,
    });
    expect(await httpEntryProbe("wss://sk.example/ws", fetcher)("create")).toEqual({
      status: 429,
      waitMs: 27_000,
    });
    expect(urls).toEqual(["https://sk.example/ws", "https://sk.example/ws?entry=create"]);
  });
});

describe("R-39 with the server open", () => {
  const OLD_KEY = "ABCDEFGHJKMNPQRS";

  it("T-39.20 an old stored key is harmless: no «Clave del grupo», and it is kept", () => {
    const transport = fakeTransport();
    transport.setStatus("idle");
    const session = memorySession();
    session.saveAccessKey(OLD_KEY);
    const client = new GameClient({ transport, prefs: memoryPrefs(), session });
    render(<Screens client={client} />);
    fireEvent.change(screen.getByLabelText("Tu apodo"), { target: { value: "Inés" } });
    fireEvent.click(screen.getByRole("button", { name: CREATE }));
    transport.setStatus("open");
    expect(transport.last("room.create")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Clave del grupo" })).toBeNull();
    expect(session.accessKey()).toBe(OLD_KEY);
  });

  it("T-39.21 an old invitation link asks for nothing while it checks, and with 204 it never shows «Clave del grupo»", async () => {
    let answer: (status: number | null) => void = () => undefined;
    const transport = fakeTransport();
    Object.assign(transport, {
      checkAccess: () => new Promise<number | null>((resolve) => (answer = resolve)),
    });
    transport.setStatus("idle");
    const session = memorySession();
    const client = new GameClient({ transport, prefs: memoryPrefs(), session });
    client.acceptInvitation(OLD_KEY);
    window.history.replaceState(null, "", "#/");
    render(<Screens client={client} />);
    expect(screen.getByRole("heading", { name: "Comprobando el enlace…" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Clave del grupo" })).toBeNull();
    expect(screen.queryByLabelText("Clave")).toBeNull();
    await act(async () => {
      answer(204);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole("heading", { name: "Comprobando el enlace…" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Clave del grupo" })).toBeNull();
  });

  it("T-39.21 negative check: with the server closed and a wrong key, it does ask for the key", async () => {
    const transport = fakeTransport();
    Object.assign(transport, { checkAccess: () => Promise.resolve(401) });
    transport.setStatus("idle");
    const client = new GameClient({ transport, prefs: memoryPrefs(), session: memorySession() });
    client.acceptInvitation(OLD_KEY);
    render(<Screens client={client} />);
    await flush();
    expect(screen.getByRole("heading", { name: "Clave del grupo" })).toBeDefined();
    expect(screen.getByLabelText("Clave")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toMatch(/no vale/);
  });
});
