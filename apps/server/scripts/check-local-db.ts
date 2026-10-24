// Comprueba la base de datos local sin mostrar `DATABASE_URL`: se conecta con la URL de
// `apps/server/.env`, y dice con qué usuario, a qué base y a qué dirección del servidor.
//
// Uso: pnpm --filter @sudoku-killer/server db:check-local
import pg from "pg";

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("✗ Falta DATABASE_URL en apps/server/.env.");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const { rows } = await client.query<{
    user: string;
    database: string;
    server: string | null;
    version: string;
  }>(
    "SELECT current_user AS user, current_database() AS database, host(inet_server_addr()) AS server, current_setting('server_version') AS version",
  );
  const row = rows[0];
  console.log(
    `✓ Conectado como ${row?.user ?? "?"} a ${row?.database ?? "?"} en ${row?.server ?? "?"} (PostgreSQL ${row?.version ?? "?"}).`,
  );
} catch (error) {
  const code = error instanceof Error && "code" in error ? String(error.code) : "desconocido";
  console.error(`✗ No se pudo conectar (código ${code}).`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
