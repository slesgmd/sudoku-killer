// Base de datos del servidor: cualquier driver de PostgreSQL de Drizzle (PGlite en las pruebas).
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema.ts";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
