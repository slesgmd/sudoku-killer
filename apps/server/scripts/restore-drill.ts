// Simulacro de restauración (F12i; `restore-drill.yml`, a mano): baja el último respaldo cifrado
// (artefacto `db-backup` de `backup.yml`), lo descifra con la clave privada de `age`
// (BACKUP_AGE_KEY, secreto de Actions), lo restaura en un PostgreSQL efímero
// (RESTORE_DATABASE_URL) y lo comprueba: recuentos y arranque del servidor con la reconstrucción de
// las partidas. Solo escribe recuentos (`restore.*`); la clave y el volcado viven en un directorio
// temporal que se borra.
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../src/db/connect.ts";
import { RESTORE_DATABASE, StepError, freshDatabase, restoreDump, run } from "./db/pg-tools.ts";
import { bootOn, printCounts, tableCounts } from "./db/restore-check.ts";

export const ARTIFACT_NAME = "db-backup";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new StepError(`env_${name.toLowerCase()}`);
  return value;
}

interface Artifact {
  readonly expired: boolean;
  readonly created_at: string;
  readonly archive_download_url: string;
}

/** El artefacto más reciente y vigente con ese nombre (la API los da del más nuevo al más viejo). */
export function latestArtifact(artifacts: readonly Artifact[]): Artifact | null {
  return (
    artifacts
      .filter((artifact) => !artifact.expired)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
  );
}

async function download(dir: string): Promise<{ file: string; ageHours: number }> {
  const token = env("GITHUB_TOKEN");
  const repository = env("GITHUB_REPOSITORY");
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" };
  const list = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts?name=${ARTIFACT_NAME}&per_page=20`,
    { headers },
  );
  if (!list.ok) throw new StepError("list_artifacts");
  const artifact = latestArtifact(((await list.json()) as { artifacts: Artifact[] }).artifacts);
  if (!artifact) throw new StepError("no_backup");
  const zip = await fetch(artifact.archive_download_url, { headers });
  if (!zip.ok) throw new StepError("download_artifact");
  const zipFile = join(dir, "backup.zip");
  writeFileSync(zipFile, Buffer.from(await zip.arrayBuffer()));
  await run("unzip", "unzip", ["-q", "-o", zipFile, "-d", join(dir, "artifact")]);
  const encrypted = readdirSync(join(dir, "artifact")).find((name) => name.endsWith(".age"));
  if (encrypted === undefined) throw new StepError("no_encrypted_file");
  const ageHours = Math.round((Date.now() - Date.parse(artifact.created_at)) / 3_600_000);
  return { file: join(dir, "artifact", encrypted), ageHours };
}

async function main(): Promise<void> {
  const restoreAdmin = env("RESTORE_DATABASE_URL");
  const key = env("BACKUP_AGE_KEY");
  const dir = mkdtempSync(join(tmpdir(), "sk-restore-"));
  try {
    // Con BACKUP_FILE (pruebas locales) no se baja nada.
    const local = process.env["BACKUP_FILE"];
    const { file, ageHours } =
      local === undefined || local === "" ? await download(dir) : { file: local, ageHours: 0 };
    console.log(`restore.backup_age_hours: ${String(ageHours)}`);
    const keyFile = join(dir, "age.key");
    writeFileSync(keyFile, `${key.trim()}\n`, { mode: 0o600 });
    const dump = join(dir, "sudoku-killer.dump");
    await run("age_decrypt", "age", ["--decrypt", "--identity", keyFile, "--output", dump, file]);
    rmSync(keyFile);

    const target = await freshDatabase(restoreAdmin, RESTORE_DATABASE);
    await restoreDump(dump, target);
    const restored = connect(target);
    try {
      const counts = await tableCounts(restored.db);
      printCounts("restore", counts);
      if (counts.puzzlesActive === 0) throw new StepError("empty_bank");
      console.log(`restore.matches_rebuilt: ${String(await bootOn(restored.db))}`);
    } finally {
      await restored.close();
    }
    console.log("restore.done: ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  try {
    await main();
  } catch (error) {
    console.log(`restore.step_${error instanceof StepError ? error.message : "unexpected"}: fail`);
    process.exitCode = 1;
  }
}
