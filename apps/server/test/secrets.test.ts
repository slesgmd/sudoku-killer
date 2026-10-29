// Secretos del despliegue: el proceso real del servidor (`src/index.ts`), con la cadena de
// conexión y el hash de la clave definidos como en el panel del hosting, nunca los escribe en su
// salida, ni al arrancar ni al fallar.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const PASSWORD = "pw-f12c-never-logged";
const HASH = `sha256:${"7e".repeat(32)}`;

function run(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--conditions=@sudoku-killer/source", ENTRY], {
      env: { PATH: process.env["PATH"] ?? "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.on("close", (code) => {
      resolve({ code, output });
    });
  });
}

describe("F12 secrets never reach the server output", () => {
  it("a server that cannot reach its database fails without printing DATABASE_URL or ACCESS_KEY_HASH", async () => {
    const { code, output } = await run({
      NODE_ENV: "production",
      // Un puerto cerrado: la conexión falla en el acto.
      DATABASE_URL: `postgres://sudoku_killer:${PASSWORD}@127.0.0.1:1/sudoku_killer`,
      ACCESS_KEY_HASH: HASH,
      PORT: "0",
    });
    expect(code).toBe(1);
    expect(output).toContain("server failed to start");
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain(HASH.slice("sha256:".length));
  }, 30_000);

  it("a production server without ACCESS_KEY_HASH refuses to start, naming only the variable", async () => {
    const { code, output } = await run({
      NODE_ENV: "production",
      DATABASE_URL: `postgres://sudoku_killer:${PASSWORD}@127.0.0.1:1/sudoku_killer`,
    });
    expect(code).toBe(1);
    expect(output).toMatch(/falta ACCESS_KEY_HASH/);
    expect(output).not.toContain(PASSWORD);
  }, 30_000);
});
