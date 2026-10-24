// Persistencia (ADR 0003, 0004 y 0006) con PGlite: retiro de puzzles al cambiar el manifiesto,
// confirmación antes de difundir (T-32.3), reconstrucción tras un reinicio (T-32.2, T-07.3, E-15),
// fallo de la base de datos (E-16), idempotencia tras una reconexión (E-07) y la comprobación del
// banco al arrancar.
import { replay } from "@sudoku-killer/game";
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { CLOSE_SERVICE_RESTART } from "../src/rooms/limits.ts";
import { createMatchRepository } from "../src/match/repository.ts";
import { EmptyBankError, createPuzzleCatalog } from "../src/puzzles/catalog.ts";
import { loadBank } from "../src/puzzles/load-bank.ts";
import { createPuzzleRepository } from "../src/puzzles/repository.ts";
import { hashToken } from "../src/infra/tokens.ts";
import { readManifest } from "./helpers/bank.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { answer, firstEmpty, playerIn, started, table, wrong } from "./helpers/play.ts";
import { createTestServer, errorOf, mode, testBank, welcomeOf } from "./helpers/server.ts";

const GRACE = 120_000;
const SLOW = { timeout: 120_000 };

beforeAll(async () => {
  await testBank();
}, 60_000);

describe("ADR 0006 changing the manifest", () => {
  it(
    "retires the puzzles that leave the manifest, never deletes them, and reactivates them",
    SLOW,
    async () => {
      const { db, client } = await createTestDatabase();
      const manifest = readManifest();
      const firstOf = (from: number, count: number) =>
        DIFFICULTIES.flatMap((d) =>
          manifest.entries.filter((e) => e.difficulty === d).slice(from, from + count),
        );
      const a = { ...manifest, entries: firstOf(0, 2) };
      const b = { ...manifest, entries: firstOf(1, 2) };
      const [old] = a.entries;
      if (!old) throw new Error("Empty manifest");
      // Una fila de otra equivalencia: misma semilla y generador, otros números iniciales (otro hash).
      await client.query(
        `INSERT INTO puzzles (size, box_rows, box_cols, difficulty, cages, givens, solution, grader_max_level,
        grader_steps, grader_version, givens_reason, generator_version, seed, hash, mapping_version)
       VALUES (9, 3, 3, $1, '[]', '[]', $2, 1, 1, '2', 'none', $3, $4, 'older-equivalence', '1')`,
        [old.difficulty, "1".repeat(81), manifest.generatorVersion, old.seed],
      );
      expect(await loadBank(db, a)).toEqual({
        inserted: 8,
        existing: 0,
        reactivated: 0,
        retired: 1,
      });

      // Una partida sobre un puzzle de A que no está en B.
      const repository = createPuzzleRepository(db);
      const aIds = new Set<string>();
      for (const d of DIFFICULTIES) for (const id of await repository.listIds(d)) aIds.add(id);
      const matches = createMatchRepository(db);
      const catalogA = await createPuzzleCatalog(repository);

      expect(await loadBank(db, b)).toEqual({
        inserted: 4,
        existing: 4,
        reactivated: 0,
        retired: 4,
      });
      expect(
        (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM puzzles")).rows[0]?.n,
      ).toBe(13);
      const bIds = new Set<string>();
      for (const d of DIFFICULTIES) for (const id of await repository.listIds(d)) bIds.add(id);
      expect(bIds.size).toBe(8);
      expect([...bIds].filter((id) => aIds.has(id))).toHaveLength(4);
      expect(await repository.countByDifficulty()).toEqual({
        easy: 2,
        medium: 2,
        hard: 2,
        expert: 2,
      });

      // La partida vieja conserva su puzzle retirado y se sigue reproduciendo.
      const onlyInA = [...aIds].find((id) => !bIds.has(id));
      if (!onlyInA) throw new Error("No puzzle");
      const { puzzle } = await catalogA.get(onlyInA);
      const matchId = "6f9b8f3e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
      await matches.commit({
        matches: [
          {
            id: matchId,
            roomCode: "ABCDEF",
            puzzleId: onlyInA,
            difficulty: puzzle.difficulty,
            modeId: mode.id,
            scoringParamsVersion: mode.scoringParamsVersion,
            protocolVersion: 1,
            startedAt: 1_000,
          },
        ],
        events: [
          {
            matchId,
            event: {
              seq: 1,
              ts: 1_000,
              type: "match.started",
              payload: {
                matchId,
                puzzleId: onlyInA,
                difficulty: puzzle.difficulty,
                modeId: mode.id,
                scoringParamsVersion: mode.scoringParamsVersion,
                hintsTotal: 3,
                starterId: null,
                players: [],
              },
            },
          },
        ],
      });
      const retiredPuzzle = await (await createPuzzleCatalog(repository)).get(onlyInA);
      expect(
        replay(await matches.events(matchId), { mode, puzzle: retiredPuzzle.puzzle }).puzzle.id,
      ).toBe(onlyInA);

      expect(await loadBank(db, a)).toEqual({
        inserted: 0,
        existing: 8,
        reactivated: 4,
        retired: 4,
      });
      await client.close();
    },
  );

  it("the server does not start if a difficulty has no puzzles", SLOW, async () => {
    const { db, client } = await createTestDatabase();
    await expect(createPuzzleCatalog(createPuzzleRepository(db))).rejects.toThrow(EmptyBankError);
    await expect(createPuzzleCatalog(createPuzzleRepository(db))).rejects.toThrow(/bank:load/);
    await client.close();
  });
});

describe("ADR 0004 the log in the database", () => {
  it("match_events only accepts new rows: UPDATE and DELETE fail", async () => {
    const h = await createTestServer();
    await started(h, ["Ana"]);
    const { client } = await testBank();
    await expect(client.query("UPDATE match_events SET seq = seq + 100")).rejects.toThrow(
      /append-only/,
    );
    await expect(client.query("DELETE FROM match_events")).rejects.toThrow(/append-only/);
  });

  it("T-13.4 (I) the database keeps only the token hash", async () => {
    const h = await createTestServer();
    const { clients } = await started(h, ["Ana", "Bea"]);
    const { client } = await testBank();
    const rows = await client.query<{ payload: string }>(
      "SELECT payload::text AS payload FROM match_events",
    );
    const stored = rows.rows.map((r) => r.payload).join("\n");
    for (const c of clients) {
      expect(stored).not.toContain(c.token ?? "missing");
      expect(stored).toContain(hashToken(c.token ?? ""));
    }
  });
});

describe("R-32 rebuilding after a restart (E-15)", () => {
  it("T-32.2 and T-07.3 running matches are rebuilt; players are disconnected with a new grace and come back with their token", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana?.token || !bea?.token) throw new Error();
    const cell = firstEmpty(h, code);
    await ana.send("cell.place", { cell, digit: answer(h, code, cell) });
    const noted = firstEmpty(h, code);
    await ana.send("note.add", { layer: "personal", cell: noted, digit: 5 });
    await bea.send("cell.place", { cell: noted, digit: wrong(h, code, noted) });
    const before = h.room(code).match?.state;
    const startedAt = before?.startedAt ?? 0;
    // Una sala en el lobby se pierde con el reinicio.
    const lobby = await table(h, ["Cris"]);

    await h.advance(30_000);
    expect(await h.restart()).toBe(1);
    expect(h.server.rooms.has(lobby.code)).toBe(false);
    const room = h.room(code);
    expect(room.state).toBe("running");
    for (const id of [ana.playerId, bea.playerId]) {
      expect(playerIn(h, code, id)).toMatchObject({ connection: "disconnected" });
    }
    const events = await h.repository.events(room.match?.state.id ?? "");
    expect(events.slice(-2).map((e) => [e.type, e.ts])).toEqual([
      ["player.connection", h.clock.now()],
      ["player.connection", h.clock.now()],
    ]);

    // 100 s después del reinicio (plazo nuevo de 120 s), Ana vuelve con todo.
    await h.advance(100_000);
    const back = h.client();
    const welcome = welcomeOf(await back.join(code, "Ana", ana.token));
    const snapshot = welcome.payload.snapshot;
    expect(snapshot.match?.locked).toContainEqual({
      cell,
      value: answer(h, code, cell),
      source: "solved",
      by: ana.playerId,
    });
    expect(snapshot.you.personalNotes).toEqual([{ cell: noted, mask: 1 << 4 }]);
    expect(snapshot.room.players.find((p) => p.id === bea.playerId)).toMatchObject({
      lives: 2,
      connection: "disconnected",
    });
    // T-07.3: el cronómetro incluye el tiempo de caída.
    expect(snapshot.match?.startedAt).toBe(startedAt);
    expect(snapshot.serverNow - startedAt).toBe(h.clock.now() - startedAt);
    expect(snapshot.serverNow - startedAt).toBeGreaterThanOrEqual(130_000);
    // La partida sigue: Ana juega.
    const next = firstEmpty(h, code);
    expect(
      (await back.send("cell.place", { cell: next, digit: answer(h, code, next) })).map(
        (m) => m.type,
      ),
    ).toEqual(["cell.solved"]);
    expect(errorOf(await h.client().join(lobby.code, "Dani"))).toBe("room.not_found");
  });

  it("if nobody comes back within 120 s of the restart, everybody expires, the match ends in defeat and the room is deleted", async () => {
    const h = await createTestServer();
    const { code } = await started(h, ["Ana", "Bea"]);
    const matchId = h.room(code).match?.state.id ?? "";
    await h.restart();
    await h.advance(GRACE);
    expect(h.server.rooms.has(code)).toBe(false);
    expect((await h.repository.events(matchId)).at(-1)).toMatchObject({
      type: "match.ended",
      payload: { result: "defeat" },
    });
    expect(await h.repository.listRunning()).toEqual([]);
  });

  it("the live state after a rebuild still equals replay(log) (T-32.1 across a restart)", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana] = clients;
    if (!ana?.token) throw new Error();
    await ana.send("note.add", { layer: "group", cell: firstEmpty(h, code), digit: 3 });
    await h.restart();
    welcomeOf(await h.client().join(code, "Ana", ana.token));
    const match = h.room(code).match;
    if (!match) throw new Error();
    expect(
      replay(await h.repository.events(match.state.id), { mode, puzzle: match.puzzle }),
    ).toEqual(match.state);
  });
});

describe("E-07 idempotency.reconnect", () => {
  it("a command applied while the connection drops: back with the token, the same id gets the saved result and no second penalty", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana] = clients;
    if (!ana?.token) throw new Error();
    const cell = firstEmpty(h, code);
    const id = ana.post("cell.place", { cell, digit: wrong(h, code, cell) });
    ana.link.disconnect();
    await h.settle();
    expect(ana.replies(id)).toEqual([]);
    const back = h.client();
    const welcome = welcomeOf(await back.join(code, "Ana", ana.token));
    expect(welcome.payload.snapshot.room.players.find((p) => p.id === ana.playerId)?.lives).toBe(2);
    const replies = await back.send("cell.place", { cell, digit: wrong(h, code, cell) }, id);
    expect(replies.map((m) => m.type)).toEqual(["cell.mistake"]);
    expect(playerIn(h, code, ana.playerId)).toMatchObject({ lives: 2, mistakes: 1 });
  });

  it("the deduplication survives a restart: the clientMsgId is in the event", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana"]);
    const [ana] = clients;
    if (!ana?.token) throw new Error();
    const cell = firstEmpty(h, code);
    const first = await ana.send("cell.place", { cell, digit: wrong(h, code, cell) }, "retry-me");
    await h.restart();
    const back = h.client();
    welcomeOf(await back.join(code, "Ana", ana.token));
    const again = await back.send("cell.place", { cell, digit: wrong(h, code, cell) }, "retry-me");
    expect(again).toEqual(first);
    const events = await h.repository.events(h.room(code).match?.state.id ?? "");
    expect(events.filter((e) => e.type === "cell.mistake")).toHaveLength(1);
  });
});

describe("E-16 the database fails", () => {
  it("T-32.3 an unconfirmed event is not broadcast; state-changing commands get server.unavailable; a recovery within 10 s delivers it", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    h.repository.failing = true;
    const mark = bea.mark();
    const id = ana.post("cell.place", { cell, digit: answer(h, code, cell) });
    await h.settle();
    expect(bea.since(mark)).toEqual([]);
    expect(ana.replies(id)).toEqual([]);
    expect(h.sink.unavailable).toBe(true);
    expect(errorOf(await bea.send("note.add", { layer: "group", cell, digit: 1 }))).toBe(
      "server.unavailable",
    );
    // Presencia y ping no cambian el estado: siguen respondiendo.
    await bea.send("sys.ping", { t0: 1 });
    expect(bea.last("sys.pong")).toBeDefined();

    await h.advance(5_000);
    expect(bea.all("cell.solved", mark)).toEqual([]);
    h.repository.failing = false;
    await h.advance(1_000);
    expect(ana.replies(id).map((m) => m.type)).toEqual(["cell.solved"]);
    expect(bea.all("cell.solved", mark)).toHaveLength(1);
    expect(h.sink.unavailable).toBe(false);
  });

  it("after 10 s of failure the room closes with 1012 and is rebuilt from the confirmed log; nobody saw the lost event", async () => {
    const h = await createTestServer();
    const { code, clients } = await started(h, ["Ana", "Bea"]);
    const [ana, bea] = clients;
    if (!ana?.token || !bea) throw new Error();
    const cell = firstEmpty(h, code);
    const matchId = h.room(code).match?.state.id ?? "";
    h.repository.failing = true;
    const id = ana.post("cell.place", { cell, digit: answer(h, code, cell) });
    await h.settle();
    await h.advance(10_000);
    expect(ana.link.closed?.code).toBe(CLOSE_SERVICE_RESTART);
    expect(bea.link.closed?.code).toBe(CLOSE_SERVICE_RESTART);
    expect(h.server.rooms.has(code)).toBe(false);
    expect(errorOf(await h.client().join(code, "Ana", ana.token))).toBe("server.unavailable");
    expect([...ana.messages, ...bea.messages].some((m) => m.type === "cell.solved")).toBe(false);
    expect((await h.repository.events(matchId)).some((e) => e.type === "cell.solved")).toBe(false);

    h.repository.failing = false;
    await h.advance(1_000);
    const back = h.client();
    const welcome = welcomeOf(await back.join(code, "Ana", ana.token));
    expect(welcome.payload.snapshot.match?.locked.some((l) => l.cell === cell)).toBe(false);
    // El cliente reenvía su comando pendiente con el mismo id (§4.5): ahora sí se aplica.
    const replies = await back.send("cell.place", { cell, digit: answer(h, code, cell) }, id);
    expect(replies.map((m) => m.type)).toEqual(["cell.solved"]);
  });
});
