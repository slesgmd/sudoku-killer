// `scoring:report` (F11h): analiza las partidas terminadas de la base (`DATABASE_URL`) para la
// recalibración de la puntuación (`docs/puntuacion.md`, sección 11). Solo lee: no cambia parámetros
// ni filas. La decisión sobre P y una versión nueva de los parámetros son de F13.
//
// Uso: pnpm --filter @sudoku-killer/server scoring:report [--since 2026-10-25] [--limit 500]
//        [--out informe.json]
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { and, desc, gte, isNotNull } from "drizzle-orm";
import { connect } from "../../src/db/connect.ts";
import { matches } from "../../src/db/schema.ts";
import { createMatchRepository } from "../../src/match/repository.ts";
import { createPuzzleCatalog } from "../../src/puzzles/catalog.ts";
import { createPuzzleRepository } from "../../src/puzzles/repository.ts";
import { analyze, type AnalyzedMatch } from "./analyze.ts";

const { values: args } = parseArgs({
  options: {
    since: { type: "string" },
    limit: { type: "string", default: "500" },
    out: { type: "string" },
  },
});

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("Falta DATABASE_URL (apps/server/.env).");
  process.exit(1);
}
const connection = connect(url);
try {
  const catalog = await createPuzzleCatalog(createPuzzleRepository(connection.db));
  const repository = createMatchRepository(connection.db);
  const ended = await connection.db
    .select({ id: matches.id, puzzleId: matches.puzzleId, difficulty: matches.difficulty })
    .from(matches)
    .where(
      and(
        isNotNull(matches.endedAt),
        args.since === undefined ? undefined : gte(matches.startedAt, new Date(args.since)),
      ),
    )
    .orderBy(desc(matches.startedAt))
    .limit(Number(args.limit));
  const analyzed: AnalyzedMatch[] = [];
  for (const row of ended) {
    const { puzzle } = await catalog.get(row.puzzleId);
    analyzed.push({
      difficulty: row.difficulty,
      puzzle,
      events: await repository.events(row.id),
    });
  }
  const report = analyze(analyzed);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out === undefined) process.stdout.write(text);
  else writeFileSync(args.out, text);
} finally {
  await connection.close();
}
