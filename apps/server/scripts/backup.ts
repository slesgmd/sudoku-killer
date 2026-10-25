// Respaldo de la base (F12i, ADR 0007; `backup.yml`, semanal y a mano). Vuelca la base de
// DATABASE_URL, lo restaura en un PostgreSQL efímero (RESTORE_DATABASE_URL), lo comprueba (recuentos
// y arranque del servidor con la reconstrucción) y lo cifra con `age` para BACKUP_AGE_RECIPIENT en
// BACKUP_OUT; el volcado sin cifrar se borra. El repositorio es público, y con él los logs y los
// artefactos: solo se escriben recuentos (`backup.*`, `restore.*`) y solo se sube el archivo cifrado.
// Conectarse y leer todas las tablas cuenta como uso de la base para Neon (docs/seguridad.md §3).
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../src/db/connect.ts";
import {
  RESTORE_DATABASE,
  StepError,
  freshDatabase,
  libpqUrl,
  pgTool,
  restoreDump,
  run,
} from "./db/pg-tools.ts";
import { bootOn, countProblems, printCounts, tableCounts } from "./db/restore-check.ts";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new StepError(`env_${name.toLowerCase()}`);
  return value;
}

async function main(): Promise<void> {
  const source = env("DATABASE_URL");
  const restoreAdmin = env("RESTORE_DATABASE_URL");
  const recipient = env("BACKUP_AGE_RECIPIENT");
  const out = env("BACKUP_OUT");
  const dir = mkdtempSync(join(tmpdir(), "sk-backup-"));
  const dump = join(dir, "sudoku-killer.dump");
  try {
    await run("pg_dump", pgTool("pg_dump"), [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--file=${dump}`,
      `--dbname=${libpqUrl(source)}`,
    ]);
    const origin = connect(source);
    const sourceCounts = await tableCounts(origin.db).finally(() => origin.close());
    printCounts("backup", sourceCounts);

    const target = await freshDatabase(restoreAdmin, RESTORE_DATABASE);
    await restoreDump(dump, target);
    const restored = connect(target);
    try {
      const restoredCounts = await tableCounts(restored.db);
      printCounts("restore", restoredCounts);
      const problems = countProblems(sourceCounts, restoredCounts);
      for (const problem of problems) console.log(`restore.mismatch_${problem}: fail`);
      if (problems.length > 0) throw new StepError("counts");
      console.log(`restore.matches_rebuilt: ${String(await bootOn(restored.db))}`);
    } finally {
      await restored.close();
    }

    await run("age_encrypt", "age", ["--recipient", recipient, "--output", out, dump]);
    console.log(`backup.encrypted_bytes: ${String(statSync(out).size)}`);
    console.log("backup.done: ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.log(`backup.step_${error instanceof StepError ? error.message : "unexpected"}: fail`);
  process.exitCode = 1;
}
