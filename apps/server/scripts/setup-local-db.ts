// Configura la base de datos local de desarrollo (PostgreSQL 18 en Windows) sin que nadie vea
// ninguna contraseña:
//   1. genera con node:crypto una contraseña aleatoria larga para el rol `sudoku_killer`;
//   2. abre una ventana de psql conectada como `postgres`, donde la persona escribe la contraseña de
//      `postgres` (este script no la lee ni la guarda);
//   3. crea el rol (NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS), la base
//      `sudoku_killer` con ese dueño y quita los permisos de PUBLIC;
//   4. comprueba la conexión con el rol nuevo y sus atributos;
//   5. escribe la línea `DATABASE_URL` en `apps/server/.env`.
// A psql solo le llega el verificador SCRAM-SHA-256 de la contraseña (un hash que PostgreSQL acepta
// tal cual), nunca la contraseña. La contraseña no se imprime, no va en ningún argumento ni archivo
// temporal, y solo queda en `apps/server/.env`, que no se versiona. Volver a ejecutarlo cambia la
// contraseña y reescribe la línea.
//
// Uso: pnpm --filter @sudoku-killer/server db:setup-local
import { spawnSync } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROLE = "sudoku_killer";
const DATABASE = "sudoku_killer";
const HOST = "127.0.0.1";
const PORT = 5432;
const PSQL = process.env["PSQL"] ?? "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));
const SCRAM_ITERATIONS = 4096;

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

/** Verificador SCRAM-SHA-256 de PostgreSQL (RFC 5802 y 7677), como lo guarda `pg_authid`. */
function scramVerifier(password: string): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  const b64 = (buffer: Buffer) => buffer.toString("base64");
  return `SCRAM-SHA-256$${String(SCRAM_ITERATIONS)}:${b64(salt)}$${b64(storedKey)}:${b64(serverKey)}`;
}

/** El entorno de psql: sin `PGPASSWORD`, así psql siempre pide la contraseña en su ventana. */
function psqlEnv(args: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, SK_PSQL: PSQL, SK_PSQL_ARGS: args };
  delete env["PGPASSWORD"];
  return env;
}

/** Abre psql en una ventana propia y espera a que termine. Devuelve su código de salida. */
function runPsqlWindow(commands: readonly string[]): number {
  const args = [
    "-X",
    "-q",
    "-W",
    `-h ${HOST}`,
    `-p ${String(PORT)}`,
    "-U postgres",
    "-d postgres",
    ...commands.map((command) => `-c "${command}"`),
  ].join(" ");
  // Start-Process abre una consola nueva para psql: ahí se escribe la contraseña de `postgres`.
  // La lista de argumentos llega por una variable de entorno para no pasar por otra capa de comillas.
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$p = Start-Process -FilePath $env:SK_PSQL -ArgumentList $env:SK_PSQL_ARGS -Wait -PassThru; exit $p.ExitCode",
    ],
    { stdio: "inherit", env: psqlEnv(args) },
  );
  return result.status ?? 1;
}

/** Reemplaza o agrega `KEY=valor` en el `.env`, sin tocar las demás líneas. */
function writeEnvLine(key: string, value: string): void {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [];
  const kept = lines.filter((line) => !line.startsWith(`${key}=`) && line !== "");
  writeFileSync(ENV_FILE, `${[...kept, `${key}=${value}`].join("\n")}\n`, { mode: 0o600 });
}

async function check(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{
      user: string;
      database: string;
      server: string | null;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
      owner: string;
      public_connect: boolean;
    }>(
      `SELECT current_user AS user, current_database() AS database, host(inet_server_addr()) AS server,
              r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
              pg_get_userbyid(d.datdba) AS owner,
              has_database_privilege('public', d.datname, 'CONNECT') AS public_connect
         FROM pg_roles r, pg_database d
        WHERE r.rolname = current_user AND d.datname = current_database()`,
    );
    const row = rows[0];
    if (!row) fail("No se pudo leer el rol ni la base.");
    const problems = [
      row.user !== ROLE && `el usuario es ${row.user}`,
      row.database !== DATABASE && `la base es ${row.database}`,
      row.owner !== ROLE && `la base pertenece a ${row.owner}`,
      row.rolsuper && "el rol es superusuario",
      row.rolcreatedb && "el rol puede crear bases",
      row.rolcreaterole && "el rol puede crear roles",
      row.rolreplication && "el rol tiene replicación",
      row.rolbypassrls && "el rol omite RLS",
      row.public_connect && "PUBLIC todavía puede conectarse a la base",
    ].filter((p): p is string => typeof p === "string");
    if (problems.length > 0)
      fail(`La configuración no quedó como se esperaba: ${problems.join("; ")}.`);
    console.log(
      `✓ Conexión como ${row.user} a ${row.database} (servidor ${row.server ?? "?"}): sin superusuario, sin crear bases ni roles, sin replicación ni BYPASSRLS, y PUBLIC sin acceso.`,
    );
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  if (!existsSync(PSQL))
    fail(`No se encontró psql en ${PSQL}. Indica la ruta con la variable PSQL.`);
  const password = randomBytes(32).toString("base64url");
  const verifier = scramVerifier(password);

  console.log(
    "Paso 1: se abre una ventana de psql. Escribe allí la contraseña de postgres y pulsa Enter.",
  );
  const status = runPsqlWindow([
    `DO $$BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN; END IF; END$$`,
    `ALTER ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}'`,
    // Si la base ya existe, este paso falla y psql sigue con los siguientes.
    `CREATE DATABASE ${DATABASE} OWNER ${ROLE}`,
    `ALTER DATABASE ${DATABASE} OWNER TO ${ROLE}`,
    `REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC`,
  ]);
  if (status !== 0) {
    fail(
      `psql terminó con el código ${String(status)}: la contraseña de postgres no se aceptó o se cerró la ventana. No se escribió nada en apps/server/.env.`,
    );
  }

  console.log("Paso 2: compruebo la conexión con el rol nuevo.");
  const url = `postgres://${ROLE}:${password}@${HOST}:${String(PORT)}/${DATABASE}`;
  try {
    await check(url);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "desconocido";
    fail(
      `No se pudo conectar con el rol nuevo (código ${code}). No se escribió nada en apps/server/.env.`,
    );
  }
  writeEnvLine("DATABASE_URL", url);
  console.log("✓ DATABASE_URL escrita en apps/server/.env (no se muestra su valor).");
}

await main();
