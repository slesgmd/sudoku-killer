// T-20.3: la tabla `puzzles` acepta exactamente las dificultades del protocolo.
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import { describe, expect, it } from "vitest";
import { DIFFICULTY_VALUES } from "../src/db/schema.ts";

describe("T-20.3 database difficulties", () => {
  it("the database accepts exactly the protocol's difficulties", () => {
    expect([...DIFFICULTY_VALUES]).toEqual([...DIFFICULTIES]);
  });
});
