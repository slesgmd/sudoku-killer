// Límites por IP y topes de eventos por partida (SPEC R-40, `docs/seguridad.md` S-08 y S-09): con los
// valores de producción, salvo donde se bajan para no enviar miles de mensajes.
import { beforeAll, describe, expect, it } from "vitest";
import { IpLimiter, createIpLimits, limitKey, type IpLimitSpecs } from "../src/infra/ip-limiter.ts";
import { IP_LIMITS, MATCH_CAPS } from "../src/rooms/limits.ts";
import type { MatchCaps } from "../src/rooms/match-usage.ts";
import { FakeClock } from "./helpers/clock.ts";
import { answer, emptyCells, started, table, wrong } from "./helpers/play.ts";
import {
  createTestServer,
  errorOf,
  testBank,
  welcomeOf,
  type TestClient,
  type TestServer,
} from "./helpers/server.ts";

const HOME = "203.0.113.7";
const OTHER = "198.51.100.9";
const NO_ROOM = "ZZZZZZ";

beforeAll(async () => {
  await testBank();
}, 60_000);

const server = (specs: IpLimitSpecs = IP_LIMITS, caps?: MatchCaps) =>
  createTestServer({
    limits: (clock) => createIpLimits(clock, specs),
    ...(caps === undefined ? {} : { caps }),
  });

/** `count` códigos que no existen, cada uno por su conexión. Devuelve los errores recibidos. */
async function missJoins(h: TestServer, address: string | null, count: number): Promise<string[]> {
  const errors: string[] = [];
  for (let i = 0; i < count; i++) {
    errors.push(errorOf(await h.client(address).join(NO_ROOM, "Ana")) ?? "none");
  }
  return errors;
}

describe("T-40.1 the limiter", () => {
  const clock = () => new FakeClock();
  const burst = [{ max: 2, windowMs: 1_000, waitMs: 5_000 }];

  it("waits only after more than `max` in the window, and the wait ends", async () => {
    const c = clock();
    const limiter = new IpLimiter({ spec: burst, clock: c });
    expect(limiter.hit(HOME)).toBe(0);
    expect(limiter.hit(HOME)).toBe(0);
    expect(limiter.lockedFor(HOME)).toBe(0);
    expect(limiter.hit(HOME)).toBe(5_000);
    expect(limiter.lockedFor(HOME)).toBe(5_000);
    expect(limiter.lockedFor(OTHER)).toBe(0);
    await c.advance(5_000, () => Promise.resolve());
    expect(limiter.lockedFor(HOME)).toBe(0);
    expect(limiter.hit(HOME)).toBe(0);
  });

  it("a new window starts from zero (negative check: spread out, no wait)", async () => {
    const c = clock();
    const limiter = new IpLimiter({ spec: burst, clock: c });
    for (let i = 0; i < 20; i++) {
      expect(limiter.hit(HOME)).toBe(0);
      await c.advance(600, () => Promise.resolve());
    }
  });

  it("the long window keeps adding after a burst; without waitMs, it waits until its end", async () => {
    const c = clock();
    const limiter = new IpLimiter({
      spec: [
        { max: 2, windowMs: 1_000, waitMs: 2_000 },
        { max: 4, windowMs: 100_000 },
      ],
      clock: c,
    });
    limiter.hit(HOME);
    limiter.hit(HOME);
    expect(limiter.hit(HOME)).toBe(2_000);
    await c.advance(2_000, () => Promise.resolve());
    limiter.hit(HOME);
    expect(limiter.hit(HOME)).toBe(98_000);
    expect(limiter.lockedFor(HOME)).toBe(98_000);
  });

  it("an unknown address never counts nor waits", () => {
    const limiter = new IpLimiter({ spec: burst, clock: clock() });
    for (let i = 0; i < 50; i++) expect(limiter.hit(null)).toBe(0);
    expect(limiter.lockedFor(null)).toBe(0);
    expect(limiter.tracked).toBe(0);
  });

  it("groups IPv6 by its /64, and nothing else", () => {
    expect(limitKey(HOME)).toBe(HOME);
    expect(limitKey("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(limitKey("2001:db8:1:2::9")).toBe("2001:db8:1:2::/64");
    expect(limitKey("2001:db8::9")).toBe("2001:db8:0:0::/64");
    expect(limitKey("::1")).toBe("0:0:0:0::/64");
    const limiter = new IpLimiter({ spec: burst, clock: clock() });
    limiter.hit("2001:db8:1:2::a");
    limiter.hit("2001:db8:1:2::b");
    expect(limiter.hit("2001:db8:1:2::c")).toBe(5_000);
    expect(limiter.lockedFor("2001:db8:1:3::a")).toBe(0);
  });

  it("remembers a bounded number of addresses", () => {
    const c = clock();
    const limiter = new IpLimiter({ spec: burst, clock: c, maxTracked: 100 });
    for (let i = 0; i < 1_000; i++) limiter.hit(`10.0.${String(i >> 8)}.${String(i & 255)}`);
    expect(limiter.tracked).toBeLessThanOrEqual(100);
    expect(limiter.hit("10.9.9.9")).toBe(0);
  });
});

describe("R-40 failed joins per address", () => {
  it("T-40.2 only more than 12 in 10 s waits 30 s; another address is not affected, and the wait ends", async () => {
    const h = await server();
    expect(await missJoins(h, HOME, 13)).toEqual(new Array(13).fill("room.not_found"));
    expect(await missJoins(h, HOME, 1)).toEqual(["rate_limited"]);
    expect(await missJoins(h, OTHER, 1)).toEqual(["room.not_found"]);
    expect(h.limits?.join.locked).toBe(1);
    expect(h.limits?.join.lockedFor(HOME)).toBe(30_000);
    await h.advance(30_000);
    expect(await missJoins(h, HOME, 1)).toEqual(["room.not_found"]);
  });

  it("T-40.2 more than 30 in 10 min waits 5 min, even without a burst", async () => {
    const h = await server();
    for (let i = 0; i < 31; i++) {
      await h.advance(11_000);
      expect(await missJoins(h, HOME, 1), String(i)).toEqual(["room.not_found"]);
    }
    expect(await missJoins(h, HOME, 1)).toEqual(["rate_limited"]);
    expect(h.limits?.join.lockedFor(HOME)).toBe(300_000);
  });

  it("T-40.3 nickname.taken, room.full, nickname.invalid and a valid token do not count", async () => {
    const h = await server();
    const { code, clients } = await table(h, ["Ana", "Beto", "Cris", "Dani", "Eli", "Fede"]);
    const [ana] = clients;
    for (let i = 0; i < 40; i++) {
      const taken = h.client(HOME);
      // Sala llena: 6 asientos ocupados.
      expect(errorOf(await taken.join(code, `Otro${String(i)}`))).toBe("room.full");
      expect(errorOf(await h.client(HOME).join(code, "x"))).toBe("nickname.invalid");
      await taken.drop();
    }
    const free = await table(h, ["Gaby"]);
    for (let i = 0; i < 40; i++) {
      expect(errorOf(await h.client(HOME).join(free.code, "Gaby"))).toBe("nickname.taken");
    }
    const token = ana?.token ?? "";
    for (let i = 0; i < 40; i++) {
      welcomeOf(await h.client(HOME).join(code, "Ana", token));
    }
    expect(h.limits?.join.lockedFor(HOME)).toBe(0);
    expect(h.limits?.join.locked).toBe(0);
    expect(errorOf(await h.client(HOME).join(NO_ROOM, "Ana"))).toBe("room.not_found");
  });

  it("T-40.4 waiting, a valid token enters; without one the answer is the same whether the room exists or not", async () => {
    const h = await server();
    const { code, clients } = await table(h, ["Ana", "Beto"]);
    const token = clients[0]?.token ?? "";
    await missJoins(h, HOME, 13);
    const answers = {
      none: errorOf(await h.client(HOME).join(code, "Cris")),
      fake: errorOf(await h.client(HOME).join(code, "Cris", "f".repeat(32))),
      noRoom: errorOf(await h.client(HOME).join(NO_ROOM, "Cris")),
      noRoomToken: errorOf(await h.client(HOME).join(NO_ROOM, "Cris", token)),
    };
    expect(answers).toEqual({
      none: "rate_limited",
      fake: "rate_limited",
      noRoom: "rate_limited",
      noRoomToken: "rate_limited",
    });
    welcomeOf(await h.client(HOME).join(code, "Ana", token));
    // Otra dirección no espera.
    welcomeOf(await h.client(OTHER).join(code, "Cris"));
  });

  it("T-40.8 an unknown address shares no limit (the lesson of T-39.7 and T-39.8)", async () => {
    const h = await server();
    expect(await missJoins(h, null, 100)).not.toContain("rate_limited");
    expect(h.limits?.join.locked).toBe(0);
    expect(h.limits?.join.tracked).toBe(0);
    const creator = h.client(null);
    for (let i = 0; i < 20; i++) welcomeOf(await h.client(null).create(`A${String(i)}`));
    welcomeOf(await creator.create("Otro"));
  });

  it("without limits nothing is limited (negative check)", async () => {
    const h = await createTestServer();
    expect(await missJoins(h, HOME, 40)).not.toContain("rate_limited");
  });
});

describe("T-40.5 room.create per address", () => {
  it("six at once pass; the seventh waits 30 s and creates nothing", async () => {
    const h = await server();
    for (let i = 0; i < 6; i++) welcomeOf(await h.client(HOME).create(`A${String(i)}`));
    expect(h.server.rooms.size).toBe(6);
    expect(errorOf(await h.client(HOME).create("Siete"))).toBe("rate_limited");
    expect(h.server.rooms.size).toBe(6);
    welcomeOf(await h.client(OTHER).create("Otra"));
    expect(h.limits?.create.lockedFor(HOME)).toBe(30_000);
    await h.advance(30_000);
    welcomeOf(await h.client(HOME).create("Vuelve"));
  });

  it("more than 15 in 10 min waits 5 min", async () => {
    const h = await server();
    let created = 0;
    for (let i = 0; i < 16; i++) {
      await h.advance(11_000);
      if (errorOf(await h.client(HOME).create(`A${String(i)}`)) === undefined) created++;
    }
    expect(created).toBe(15);
    expect(h.limits?.create.lockedFor(HOME)).toBe(300_000);
  });

  it("an invalid nickname does not count", async () => {
    const h = await server();
    for (let i = 0; i < 30; i++) {
      expect(errorOf(await h.client(HOME).create("x"))).toBe("nickname.invalid");
    }
    expect(h.limits?.create.lockedFor(HOME)).toBe(0);
    welcomeOf(await h.client(HOME).create("Valida"));
  });
});

/** Una nota que se pone y se quita: siempre escribe un evento. */
async function noteOps(client: TestClient, cell: number, count: number): Promise<string[]> {
  const errors: string[] = [];
  for (let i = 0; i < count; i++) {
    const type = i % 2 === 0 ? "note.add" : "note.remove";
    errors.push(errorOf(await client.send(type, { layer: "group", cell, digit: 1 })) ?? "none");
  }
  return errors;
}

const LOW_CAPS: MatchCaps = { notesPerPlayer: 4, joinsPerMatch: 2, connectionsPerPlayer: 4 };

describe("R-40 event caps per match (S-09)", () => {
  it("T-40.16 production values sit far above an intense match", () => {
    // Una partida intensa: unos 1 500 eventos de notas por jugador; 21 de conexión es lo más medido.
    expect(MATCH_CAPS.notesPerPlayer).toBeGreaterThanOrEqual(3 * 1_500);
    expect(MATCH_CAPS.connectionsPerPlayer).toBeGreaterThanOrEqual(10 * 21);
    expect(MATCH_CAPS.joinsPerMatch).toBeGreaterThanOrEqual(4 * 6);
  });

  it("T-40.17 past the cap, notes and settings get rate_limited and write nothing; numbers still work and each player has their own cap", async () => {
    const h = await createTestServer({ caps: LOW_CAPS });
    const { code, clients } = await started(h, ["Ana", "Beto"]);
    const [ana, beto] = clients;
    if (!ana || !beto) throw new Error("No players");
    const [cell = 0] = emptyCells(h, code);
    expect(await noteOps(ana, cell, 4)).toEqual(new Array(4).fill("none"));
    const matchId = h.room(code).match?.state.id ?? "";
    const before = (await h.repository.events(matchId)).length;
    expect(await noteOps(ana, cell, 2)).toEqual(new Array(2).fill("rate_limited"));
    expect(errorOf(await ana.send("settings.update", { autoCleanPersonalNotes: false }))).toBe(
      "rate_limited",
    );
    expect(h.server.eventsCapped).toBe(3);
    await h.settle();
    expect(await h.repository.events(matchId)).toHaveLength(before);
    // Los otros tipos tienen su propio tope natural: colocar números sigue funcionando.
    expect(
      errorOf(await ana.send("cell.place", { cell, digit: answer(h, code, cell) })),
    ).toBeUndefined();
    // Otro jugador no pierde lo suyo (un extraño no agota el tope de los demás).
    const [other = 1] = emptyCells(h, code);
    expect(await noteOps(beto, other, 2)).toEqual(new Array(2).fill("none"));
  });

  it("T-40.17 with a higher cap the same commands pass (negative check)", async () => {
    const h = await createTestServer({ caps: { ...LOW_CAPS, notesPerPlayer: 100 } });
    const { code, clients } = await started(h, ["Ana"]);
    const [cell = 0] = emptyCells(h, code);
    const [ana] = clients;
    if (!ana) throw new Error("No players");
    expect(await noteOps(ana, cell, 8)).toEqual(new Array(8).fill("none"));
    expect(h.server.eventsCapped).toBe(0);
  });

  it("T-40.18 past the cap of joins in a running match, a new player gets rate_limited; the lobby is not limited", async () => {
    const h = await createTestServer({ caps: LOW_CAPS });
    const lobby = await table(h, ["Lia"]);
    for (const name of ["Uno", "Dos", "Tres"]) welcomeOf(await h.client().join(lobby.code, name));
    const { code } = await started(h, ["Ana"]);
    welcomeOf(await h.client().join(code, "Beto"));
    welcomeOf(await h.client().join(code, "Cris"));
    expect(errorOf(await h.client().join(code, "Dani"))).toBe("rate_limited");
    expect(h.room(code).members.size).toBe(3);
  });

  it("T-40.19 past the cap of connection changes, a player cannot come back until the match ends; replacing a live connection is not limited", async () => {
    const h = await createTestServer({ caps: LOW_CAPS });
    const { code, clients } = await started(h, ["Ana", "Beto"]);
    let [, beto] = clients;
    if (!beto) throw new Error("No players");
    const token = beto.token ?? "";
    for (let i = 0; i < 2; i++) {
      await beto.drop();
      beto = h.client();
      welcomeOf(await beto.join(code, "Beto", token));
    }
    // Otra pestaña (E-08) no escribe ningún evento.
    const tab = h.client();
    welcomeOf(await tab.join(code, "Beto", token));
    await tab.drop();
    expect(errorOf(await h.client().join(code, "Beto", token))).toBe("rate_limited");
    expect(h.server.eventsCapped).toBe(1);
    // Ana no se ve afectada.
    welcomeOf(await h.client().join(code, "Ana", clients[0]?.token ?? ""));
  });

  it("T-40.20 after a restart the counters are rebuilt from the log (T-32.2), for notes, joins and connections", async () => {
    const h = await createTestServer({ caps: LOW_CAPS });
    const { code, clients } = await started(h, ["Ana", "Beto"]);
    const [ana] = clients;
    if (!ana) throw new Error("No players");
    const [cell = 0] = emptyCells(h, code);
    expect(await noteOps(ana, cell, 4)).not.toContain("rate_limited");
    welcomeOf(await h.client().join(code, "Cris"));
    welcomeOf(await h.client().join(code, "Dani"));
    expect(await h.restart()).toBe(1);
    const usage = h.room(code).match?.usage;
    expect(usage?.notesOf(ana.playerId ?? "")).toBe(4);
    expect(usage?.joins).toBe(2);
    const back = h.client();
    welcomeOf(await back.join(code, "Ana", ana.token ?? ""));
    expect(await noteOps(back, cell, 1)).toEqual(["rate_limited"]);
    expect(errorOf(await h.client().join(code, "Eli"))).toBe("rate_limited");
  });

  it("T-40.21 a new match starts from zero, but repeating matches does not escape the budget per address", async () => {
    const h = await createTestServer({
      caps: LOW_CAPS,
      limits: (clock) =>
        createIpLimits(clock, {
          ...IP_LIMITS,
          events: [{ max: 12, windowMs: 600_000, waitMs: 300_000 }],
        }),
    });
    const ana = h.client(HOME);
    const code = welcomeOf(await ana.create("Ana")).payload.snapshot.room.code;
    const errors: string[] = [];
    const lose = async () => {
      expect(errorOf(await ana.send("match.start", {}))).toBeUndefined();
      const [cell = 0] = emptyCells(h, code);
      errors.push(...(await noteOps(ana, cell, 4)));
      for (const offset of [0, 1, 2]) {
        await ana.send("cell.place", { cell, digit: wrong(h, code, cell, offset) });
      }
      await ana.send("room.reset", {});
    };
    await lose();
    expect(errors).toEqual(new Array(4).fill("none"));
    // Uno de start, 4 de notas, 3 de errores y uno de reset: 9 de los 12.
    await ana.send("match.start", {});
    const [cell = 0] = emptyCells(h, code);
    const rest = await noteOps(ana, cell, 3);
    expect(rest).toEqual(["none", "none", "rate_limited"]);
    expect(h.limits?.events.locked).toBe(1);
    expect(h.limits?.events.lockedFor(HOME)).toBe(300_000);
    // La presencia y el ping no escriben en el registro y no cuentan.
    const lockedBefore = h.limits?.events.locked;
    ana.post("presence.select", { cell });
    ana.post("sys.ping", { t0: 1 });
    await h.settle();
    expect(h.limits?.events.locked).toBe(lockedBefore);
  });
});
