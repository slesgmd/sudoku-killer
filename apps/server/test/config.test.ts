// Configuración desde el entorno: los errores nombran la variable y apps/server/.env, nunca el valor;
// y las pruebas no usan `DATABASE_URL` (siempre PGlite en memoria).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import {
  ConfigError,
  DEV_ORIGIN,
  isPrivateIPv4,
  lanOrigins,
  loadConfig,
} from "../src/config/config.ts";
import { table } from "./helpers/play.ts";
import { createTestServer, testBank } from "./helpers/server.ts";

const URL_WITH_SECRET = "postgres://sudoku_killer:s3cr3t-value@127.0.0.1:5432/sudoku_killer";
const HASH = `sha256:${"ab".repeat(32)}`;

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
      production: false,
      accessKeyHash: null,
      trustProxyHops: 0,
    });
  });

  it("F12 production requires ACCESS_KEY_HASH, and reports a bad one by name, never by value", () => {
    const production = { DATABASE_URL: URL_WITH_SECRET, NODE_ENV: "production" };
    expect(() => loadConfig(production)).toThrow(/falta ACCESS_KEY_HASH/);
    const config = loadConfig({ ...production, ACCESS_KEY_HASH: HASH, TRUST_PROXY_HOPS: "1" });
    expect(config).toMatchObject({ production: true, accessKeyHash: HASH, trustProxyHops: 1 });
    let message = "";
    try {
      loadConfig({ ...production, ACCESS_KEY_HASH: "s3cr3t-key", TRUST_PROXY_HOPS: "9" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toMatch(/ACCESS_KEY_HASH no es válida/);
    expect(message).toMatch(/TRUST_PROXY_HOPS no es válida/);
    expect(message).not.toContain("s3cr3t");
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

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: null,
  };
}

const INTERFACES: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  lo: [ipv4("127.0.0.1", true)],
  wifi: [
    ipv4("192.168.1.20"),
    {
      address: "fe80::1",
      netmask: "ffff:ffff:ffff:ffff::",
      family: "IPv6",
      mac: "00:00:00:00:00:00",
      internal: false,
      cidr: null,
      scopeid: 1,
    },
  ],
  vpn: [ipv4("10.8.0.2")],
  docker: [ipv4("172.17.0.1")],
  public: [ipv4("203.0.113.7"), ipv4("172.32.0.1")],
};

describe("dev:lan origins (F10, only in development)", () => {
  it("recognizes only private IPv4 addresses (RFC 1918)", () => {
    for (const address of ["10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.0.10"]) {
      expect(isPrivateIPv4(address), address).toBe(true);
    }
    for (const address of [
      "127.0.0.1",
      "172.15.0.1",
      "172.32.0.1",
      "8.8.8.8",
      "192.169.0.1",
      "x",
    ]) {
      expect(isPrivateIPv4(address), address).toBe(false);
    }
  });

  it("lists the Vite origin on each private IPv4 of the machine", () => {
    expect(lanOrigins(INTERFACES)).toEqual([
      "http://192.168.1.20:5173",
      "http://10.8.0.2:5173",
      "http://172.17.0.1:5173",
    ]);
  });

  it("--lan adds them to ALLOWED_ORIGINS; without it, nothing changes", () => {
    const env = { DATABASE_URL: URL_WITH_SECRET };
    expect(loadConfig(env, { interfaces: INTERFACES }).allowedOrigins).toEqual([DEV_ORIGIN]);
    expect(loadConfig(env, { lan: true, interfaces: INTERFACES }).allowedOrigins).toEqual([
      DEV_ORIGIN,
      "http://192.168.1.20:5173",
      "http://10.8.0.2:5173",
      "http://172.17.0.1:5173",
    ]);
  });

  it("--lan is refused in production", () => {
    expect(() =>
      loadConfig(
        { DATABASE_URL: URL_WITH_SECRET, NODE_ENV: "production" },
        { lan: true, interfaces: INTERFACES },
      ),
    ).toThrow(/solo para desarrollo/);
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
