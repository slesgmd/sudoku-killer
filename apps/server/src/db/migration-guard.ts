// Migraciones al arrancar (F12f): el servidor aplica las pendientes de `drizzle/` antes de escuchar,
// pero en producción una migración destructiva no se aplica sola. Una migración es destructiva si
// puede perder o reescribir datos, o romper el código que está corriendo: borra una tabla, una
// columna, un tipo, una vista, una función o un disparador; vacía o borra filas; reescribe filas con
// `UPDATE`; renombra; o cambia el tipo de una columna. Quitar un índice o una restricción no lo es.
// Para aplicarla hay que nombrarla en `MIGRATIONS_ALLOW` (decisión explícita, una por despliegue).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Database } from "./database.ts";

export interface JournalEntry {
  readonly tag: string;
  /** Marca de la migración; Drizzle la guarda como `created_at` al aplicarla. */
  readonly when: number;
}

const DESTRUCTIVE: readonly RegExp[] = [
  /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE|TYPE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|FUNCTION|TRIGGER|EXTENSION)\b/i,
  // `ALTER TABLE … DROP "columna"` (sin la palabra COLUMN); no una restricción, un índice ni un valor
  // por defecto.
  /\bALTER\s+TABLE\b[^;]*?\bDROP\s+(?!CONSTRAINT\b|DEFAULT\b|NOT\s+NULL\b|INDEX\b|IDENTITY\b|EXPRESSION\b)/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bUPDATE\s+(?:ONLY\s+)?(?:"[^"]+"|[\w.]+)(?:\s*\.\s*(?:"[^"]+"|\w+))?\s+SET\b/i,
  /\bRENAME\b/i,
  /\bALTER\s+COLUMN\b[^;]*?\b(?:SET\s+DATA\s+)?TYPE\b/i,
];

/** El SQL sin comentarios (`--` hasta el final de la línea y `/* … *\/`). */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Si el SQL de una migración tiene alguna sentencia destructiva. */
export function isDestructive(text: string): boolean {
  const code = withoutComments(text);
  return DESTRUCTIVE.some((pattern) => pattern.test(code));
}

export function readJournal(folder: string): JournalEntry[] {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  return journal.entries.map(({ tag, when }) => ({ tag, when }));
}

/** Las filas de `execute`: `pg` y PGlite las devuelven en `rows`. */
function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** La marca de la última migración aplicada, o `null` en una base sin migraciones. */
export async function lastApplied(db: Database): Promise<number | null> {
  const exists = rowsOf<{ found: boolean }>(
    await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations') is not null as found`),
  );
  if (exists[0]?.found !== true) return null;
  const result = rowsOf<{ last: string | number | null }>(
    await db.execute(sql`select max(created_at) as last from drizzle.__drizzle_migrations`),
  );
  const last = result[0]?.last;
  return last === null || last === undefined ? null : Number(last);
}

export interface MigrationPlan {
  /** Las migraciones que faltan aplicar, en orden. */
  readonly pending: readonly string[];
  /** Las pendientes destructivas que no están en `MIGRATIONS_ALLOW`. */
  readonly blocked: readonly string[];
}

/** Qué migraciones faltan y cuáles no pueden aplicarse solas (como decide Drizzle: por la marca). */
export function planMigrations(
  folder: string,
  applied: number | null,
  allow: readonly string[],
): MigrationPlan {
  const pending = readJournal(folder).filter((entry) => applied === null || entry.when > applied);
  const blocked = pending
    .filter((entry) => isDestructive(readFileSync(join(folder, `${entry.tag}.sql`), "utf8")))
    .map((entry) => entry.tag)
    .filter((tag) => !allow.includes(tag));
  return { pending: pending.map((entry) => entry.tag), blocked };
}

export class DestructiveMigrationError extends Error {
  readonly tags: readonly string[];

  constructor(tags: readonly string[]) {
    super(
      `Migraciones destructivas pendientes: ${tags.join(", ")}. No se aplican solas en producción: revísalas y nómbralas en MIGRATIONS_ALLOW para este despliegue.`,
    );
    this.name = "DestructiveMigrationError";
    this.tags = tags;
  }
}
