// Esquemas del protocolo v1 (SPEC §4 y §8.4): cada mensaje tiene un ejemplo válido y uno inválido,
// y los mensajes que la SPEC dice que no existen se rechazan con `bad_request`.
import { describe, expect, it } from "vitest";
import {
  CLIENT_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
  parseClientEnvelope,
  parseServerEnvelope,
} from "../src/index.ts";
import { CLIENT_EXAMPLES, SERVER_EXAMPLES } from "./examples.ts";

const client = (type: string, payload: unknown, extra: object = {}) => ({
  v: 1,
  id: "msg-1",
  type,
  payload,
  ...extra,
});
const server = (type: string, payload: unknown) => ({ v: 1, type, payload });

describe("client messages (SPEC §4.2, §8.4)", () => {
  it("every type has examples", () => {
    expect(Object.keys(CLIENT_EXAMPLES).sort()).toEqual([...CLIENT_MESSAGE_TYPES].sort());
  });

  for (const type of CLIENT_MESSAGE_TYPES) {
    const { valid, invalid, invalidBecause } = CLIENT_EXAMPLES[type];
    it(`${type}: accepts the valid example`, () => {
      expect(parseClientEnvelope(client(type, valid))).toMatchObject({ ok: true });
    });
    it(`${type}: rejects with bad_request (${invalidBecause})`, () => {
      expect(parseClientEnvelope(client(type, invalid))).toEqual({
        ok: false,
        code: "bad_request",
      });
    });
  }

  it("rejects envelopes without id, with an empty id or with an extra field", () => {
    const payload = CLIENT_EXAMPLES["cell.place"].valid;
    expect(parseClientEnvelope({ v: 1, type: "cell.place", payload }).ok).toBe(false);
    expect(parseClientEnvelope(client("cell.place", payload, { id: "" })).ok).toBe(false);
    expect(parseClientEnvelope(client("cell.place", payload, { seq: 3 })).ok).toBe(false);
  });

  it("E-19: another protocol version is protocol.unsupported", () => {
    expect(parseClientEnvelope(client("sys.ping", { t0: 1 }, { v: 2 }))).toEqual({
      ok: false,
      code: "protocol.unsupported",
    });
  });

  it("E-18: input that is not an object is bad_request", () => {
    expect(parseClientEnvelope("cell.place")).toEqual({ ok: false, code: "bad_request" });
    expect(parseClientEnvelope(null)).toEqual({ ok: false, code: "bad_request" });
  });

  const missing = [
    ["T-16.1", "note.toggle", { layer: "group", cell: 1, digit: 2 }],
    ["T-07.1", "match.pause", {}],
    ["T-10.2", "room.kick", { playerId: "p2" }],
    ["T-10.2", "room.close", {}],
    ["T-25.6", "cell.undo", { cell: 1 }],
    ["T-25.6", "cell.clear", { cell: 1 }],
    ["T-34.1", "match.second_chance", {}],
  ] as const;
  for (const [test, type, payload] of missing) {
    it(`${test}: ${type} does not exist and is bad_request`, () => {
      expect(parseClientEnvelope(client(type, payload))).toEqual({
        ok: false,
        code: "bad_request",
      });
    });
  }

  it("T-25.6: note.undo cannot carry a cell placement", () => {
    expect(parseClientEnvelope(client("note.undo", { opSeq: 1, cell: 3, digit: 4 })).ok).toBe(
      false,
    );
  });
});

describe("server messages (SPEC §4.3, §8.4)", () => {
  it("every type has examples", () => {
    expect(Object.keys(SERVER_EXAMPLES).sort()).toEqual([...SERVER_MESSAGE_TYPES].sort());
  });

  for (const type of SERVER_MESSAGE_TYPES) {
    const { valid, invalid, invalidBecause } = SERVER_EXAMPLES[type];
    it(`${type}: accepts the valid example`, () => {
      expect(parseServerEnvelope(server(type, valid))).toMatchObject({ ok: true });
    });
    it(`${type}: rejects the invalid example (${invalidBecause})`, () => {
      expect(parseServerEnvelope(server(type, invalid))).toEqual({
        ok: false,
        reason: "invalid",
        type,
      });
    });
  }

  it("keeps seq and replyTo", () => {
    const parsed = parseServerEnvelope({
      ...server("ack", { applied: true }),
      seq: 4,
      replyTo: "msg-1",
    });
    expect(parsed).toMatchObject({ ok: true, message: { seq: 4, replyTo: "msg-1" } });
  });

  it("§4.7: an unknown type is reported so that the client can ignore it", () => {
    expect(parseServerEnvelope(server("room.renamed", {}))).toEqual({
      ok: false,
      reason: "unknown_type",
      type: "room.renamed",
    });
  });

  it("§4.7: an unknown optional field is a compatible change and is dropped", () => {
    const parsed = parseServerEnvelope(server("ack", { applied: true, extra: 1 }));
    expect(parsed).toEqual({
      ok: true,
      message: { v: 1, type: "ack", payload: { applied: true } },
    });
  });
});
