// Configuración desde el entorno: los errores nombran la variable y apps/server/.env, nunca el valor;
// y las pruebas no usan `DATABASE_URL` (siempre PGlite en memoria).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ConfigError, DEV_ORIGIN, loadConfig } from "../src/config/config.ts";
import { table } from "./helpers/play.ts";
import { createTestServer, testBank } from "./helpers/server.ts";

const URL_WITH_SECRET = "postgres://sudoku_killer:s3cr3t-value@127.0.0.1:5432/sudoku_killer";

beforeAll(async () => {
  await testBank();
}, 60_000);

describe("server configuration", () => {
  it("uses the defaults with only DATABASE_URL", () => {
    expect(loadConfig({ DATABASE_URL: URL_WITH_SECRET })).toEqual({
      databaseUrl: URL_WITH_SECRET,
      host: "127.0.0.1",
      port: 8080,
      allowedOrigins: [DEV_ORIGIN],
      logLevel: "info",
    });
  });

  it("a missing DATABASE_URL names the variable and the .env path", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/falta DATABASE_URL.*apps\/server\/\.env/);
  });

  it("an invalid value is reported by name, never by value", () => {
    const env = { DATABASE_URL: "mysql://root:s3cr3t-value@db/x", PORT: "s3cr3t-port" };
    let message = "";
    try {
      loadConfig(env);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toMatch(/DATABASE_URL no es válida/);
    expect(message).toMatch(/PORT no es válida/);
    expect(message).not.toContain("s3cr3t");
  });

  it("parses and normalizes the allowed origins, and rejects other schemes", () => {
    const config = loadConfig({
      DATABASE_URL: URL_WITH_SECRET,
      ALLOWED_ORIGINS: "https://Juego.Example.org/, http://192.168.1.20:5173",
    });
    expect(config.allowedOrigins).toEqual([
      "https://juego.example.org",
      "http://192.168.1.20:5173",
    ]);
    expect(() =>
      loadConfig({ DATABASE_URL: URL_WITH_SECRET, ALLOWED_ORIGINS: "javascript:alert(1)" }),
    ).toThrow(/ALLOWED_ORIGINS no es válida/);
  });
});

describe("tests never use DATABASE_URL", () => {
  const saved = process.env["DATABASE_URL"];
  afterEach(() => {
    if (saved === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = saved;
  });

  it("an unreachable DATABASE_URL does not affect the test server (PGlite in memory)", async () => {
    process.env["DATABASE_URL"] = "postgres://nobody:wrong@256.0.0.1:1/nothing";
    const h = await createTestServer();
    const { code, clients } = await table(h, ["Ana"]);
    await clients[0]?.send("match.start", {});
    expect(h.room(code).state).toBe("running");
  });
});
