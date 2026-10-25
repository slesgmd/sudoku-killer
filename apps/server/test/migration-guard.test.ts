// Migraciones al arrancar (F12f): en producción una migración destructiva pendiente no se aplica sola
// (ni las que vienen antes en el mismo despliegue) salvo que esté en MIGRATIONS_ALLOW; las de hoy no
// son destructivas, así que el primer despliegue sobre una base vacía las aplica todas.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS, migrateDatabase } from "../src/db/connect.ts";
import type { Database } from "../src/db/database.ts";
import {
  DestructiveMigrationError,
  isDestructive,
  lastApplied,
  planMigrations,
  readJournal,
} from "../src/db/migration-guard.ts";
import * as schema from "../src/db/schema.ts";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function emptyDatabase(): Database {
  return drizzle({ client: new PGlite(), schema });
}

/** Una copia de `drizzle/` con migraciones nuevas al final. */
function withExtra(extra: readonly { tag: string; sql: string }[]): string {
  const folder = mkdtempSync(join(tmpdir(), "sk-migrations-"));
  folders.push(folder);
  cpSync(MIGRATIONS, folder, { recursive: true });
  const path = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(path, "utf8")) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  for (const migration of extra) {
    const last = journal.entries.at(-1);
    journal.entries.push({
      idx: (last?.idx ?? -1) + 1,
      version: "7",
      when: (last?.when ?? 0) + 1000,
      tag: migration.tag,
      breakpoints: true,
    });
    writeFileSync(join(folder, `${migration.tag}.sql`), migration.sql);
  }
  writeFileSync(path, JSON.stringify(journal));
  return folder;
}

async function tables(db: Database): Promise<string[]> {
  const result: unknown = await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  );
  return (result as { rows: { table_name: string }[] }).rows.map((row) => row.table_name).sort();
}

describe("F12f destructive migrations", () => {
  it("recognizes destructive statements, ignoring comments, indexes and constraints", () => {
    for (const statement of [
      'DROP TABLE "matches";',
      'ALTER TABLE "matches" DROP COLUMN "ended_at";',
      'ALTER TABLE "matches" DROP "ended_at";',
      "TRUNCATE match_events;",
      'DELETE FROM "puzzles" WHERE true;',
      'UPDATE "puzzles" SET "difficulty" = \'easy\';',
      "UPDATE public.puzzles SET retired = true;",
      'ALTER TABLE "matches" RENAME TO "games";',
      'ALTER TABLE "matches" RENAME COLUMN "a" TO "b";',
      'ALTER TABLE "matches" ALTER COLUMN "seq" SET DATA TYPE bigint;',
      'ALTER TABLE "matches" ALTER COLUMN "seq" TYPE bigint;',
      'DROP TRIGGER "match_events_append_only" ON "match_events";',
      "DROP TYPE difficulty;",
    ])
      expect(isDestructive(statement), statement).toBe(true);
    for (const statement of [
      'ALTER TABLE "puzzles" DROP CONSTRAINT "puzzles_givens_reason_check";',
      'DROP INDEX "puzzles_generator_seed_idx";',
      'ALTER TABLE "matches" ALTER COLUMN "x" DROP DEFAULT;',
      'ALTER TABLE "matches" ALTER COLUMN "x" DROP NOT NULL;',
      'CREATE TABLE "scratch" ("id" integer);',
      'ALTER TABLE "matches" ADD COLUMN "x" integer;',
      "-- DROP TABLE matches; solo un comentario\nSELECT 1;",
      "/* TRUNCATE x */ SELECT 1;",
      'CREATE TRIGGER "t" BEFORE UPDATE OR DELETE ON "match_events" FOR EACH ROW EXECUTE FUNCTION f();',
    ])
      expect(isDestructive(statement), statement).toBe(false);
  });

  it("none of today's migrations is destructive: the first deploy on an empty database applies them all", async () => {
    for (const { tag } of readJournal(MIGRATIONS))
      expect(isDestructive(readFileSync(join(MIGRATIONS, `${tag}.sql`), "utf8")), tag).toBe(false);
    const db = emptyDatabase();
    expect(await lastApplied(db)).toBeNull();
    const plan = await migrateDatabase(db, { guard: true });
    expect(plan).toEqual({ pending: readJournal(MIGRATIONS).map((e) => e.tag), blocked: [] });
    expect(await lastApplied(db)).toBe(readJournal(MIGRATIONS).at(-1)?.when);
    expect(planMigrations(MIGRATIONS, await lastApplied(db), [])).toEqual({
      pending: [],
      blocked: [],
    });
  });

  it("with the guard, a pending destructive migration blocks the whole deploy until MIGRATIONS_ALLOW names it", async () => {
    const db = emptyDatabase();
    await migrateDatabase(db, { guard: true });
    const folder = withExtra([
      { tag: "0003_scratch", sql: 'CREATE TABLE "scratch" ("id" integer);' },
      { tag: "0004_drop_scratch", sql: 'DROP TABLE "scratch";' },
    ]);
    const before = await lastApplied(db);
    await expect(migrateDatabase(db, { guard: true, folder })).rejects.toThrow(
      DestructiveMigrationError,
    );
    await expect(migrateDatabase(db, { guard: true, folder })).rejects.toMatchObject({
      tags: ["0004_drop_scratch"],
    });
    // No se aplicó nada, tampoco la migración inofensiva que venía antes.
    expect(await lastApplied(db)).toBe(before);
    expect(await tables(db)).not.toContain("scratch");

    const plan = await migrateDatabase(db, { guard: true, folder, allow: ["0004_drop_scratch"] });
    expect(plan).toEqual({ pending: ["0003_scratch", "0004_drop_scratch"], blocked: [] });
    expect(await tables(db)).not.toContain("scratch");
    expect(await lastApplied(db)).toBeGreaterThan(before ?? 0);
  });

  it("negative check: without the guard (development) the same destructive migration is applied, and reported", async () => {
    const db = emptyDatabase();
    await migrateDatabase(db);
    const folder = withExtra([{ tag: "0003_drop_bank", sql: 'DROP TABLE "puzzles" CASCADE;' }]);
    const plan = await migrateDatabase(db, { folder });
    expect(plan.blocked).toEqual(["0003_drop_bank"]);
    expect(await tables(db)).not.toContain("puzzles");
  });
});
