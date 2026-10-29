// Comprobación de una base restaurada (respaldo semanal y simulacro): los recuentos, lo que no
// cuadra entre el origen y lo restaurado, el arranque del servidor con la reconstrucción de una
// partida en curso, y que la salida sea solo de recuentos (`scripts/ci/quiet.ts`).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PUBLIC_LINE } from "../../../scripts/ci/quiet.ts";
import { latestArtifact } from "../scripts/restore-drill.ts";
import {
  bootOn,
  countProblems,
  printCounts,
  tableCounts,
  type TableCounts,
} from "../scripts/db/restore-check.ts";
import { started } from "./helpers/play.ts";
import { createTestServer, testBank } from "./helpers/server.ts";

beforeAll(async () => {
  await testBank();
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

const base: TableCounts = { puzzles: 8, puzzlesActive: 8, matches: 3, matchEvents: 40 };

describe("F12i restore check", () => {
  it("counts the tables and boots the server on the database, rebuilding the match in progress", async () => {
    const h = await createTestServer();
    await started(h, ["Ana", "Bea"]);
    await h.sink.drain();
    const { db } = await testBank();
    const counts = await tableCounts(db);
    expect(counts.matches).toBe(1);
    expect(counts.matchEvents).toBeGreaterThan(0);
    expect(counts.puzzlesActive).toBeGreaterThan(0);
    expect(await bootOn(db)).toBe(1);
  });

  it("finds what does not add up between the source and the restored copy", () => {
    expect(countProblems(base, base)).toEqual([]);
    // Partidas nuevas en el origen durante el volcado: no es un problema.
    expect(countProblems({ ...base, matches: 4, matchEvents: 45 }, base)).toEqual([]);
    expect(countProblems(base, { ...base, puzzles: 7, puzzlesActive: 7 })).toEqual([
      "puzzles",
      "puzzles_active",
    ]);
    expect(countProblems(base, { ...base, matches: 4, matchEvents: 41 })).toEqual([
      "matches",
      "match_events",
    ]);
    expect(countProblems({ ...base, puzzlesActive: 0 }, { ...base, puzzlesActive: 0 })).toEqual([
      "empty_bank",
    ]);
  });

  it("prints only lines that the public Actions logs let through", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });
    printCounts("backup", base);
    printCounts("restore", base);
    expect(lines).toHaveLength(8);
    for (const line of lines) expect(line).toMatch(PUBLIC_LINE);
  });

  it("the drill takes the newest backup that has not expired", () => {
    const artifact = (created_at: string, expired = false) => ({
      created_at,
      expired,
      archive_download_url: `https://api.example/${created_at}`,
    });
    expect(
      latestArtifact([
        artifact("2026-10-18T08:17:00Z"),
        artifact("2026-10-25T08:17:00Z", true),
        artifact("2026-10-11T08:17:00Z"),
      ])?.created_at,
    ).toBe("2026-10-18T08:17:00Z");
    expect(latestArtifact([])).toBeNull();
  });
});
