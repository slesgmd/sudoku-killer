// Log del servidor: nunca registra fichas, sus hash ni la cadena de conexión, aunque lleguen por
// error en los campos.
import { describe, expect, it } from "vitest";
import { createLogger, redact } from "../src/log/logger.ts";

describe("logger redaction", () => {
  it("replaces token, tokenHash, passwords and PostgreSQL URLs", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line), now: () => 0 });
    log.info("joined", {
      token: "secret-token",
      nested: { tokenHash: "abc", list: [{ password: "p" }] },
      note: "url postgres://user:pw@127.0.0.1:5432/db here",
      DATABASE_URL: "postgres://user:pw@host/db",
    });
    expect(lines).toHaveLength(1);
    const text = lines[0] ?? "";
    for (const secret of ["secret-token", "abc", '"p"', "user:pw"])
      expect(text).not.toContain(secret);
    expect(JSON.parse(text)).toMatchObject({
      level: "info",
      message: "joined",
      token: "[redacted]",
    });
  });

  it("keeps errors without leaking a connection string in the message", () => {
    const error = new Error("connect failed for postgresql://u:secret@db/x");
    expect(JSON.stringify(redact({ error }))).not.toContain("secret");
  });

  it("respects the level", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "warn", write: (line) => lines.push(line) });
    log.info("hidden");
    log.warn("shown");
    expect(lines).toHaveLength(1);
  });
});
