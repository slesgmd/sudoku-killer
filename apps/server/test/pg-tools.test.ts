// La cadena de conexión con `sslmode=verify-full` vale a la vez para node-postgres (el servidor y los
// recuentos del respaldo) y para libpq (`pg_dump` en `backup.yml`), que recibe `sslrootcert=system`
// (F12, `docs/seguridad.md` §3). Las URL son de ejemplo: ninguna apunta a una base real.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { libpqUrl } from "../scripts/db/pg-tools.ts";

const BASE = "postgresql://usuario:cl%40ve@ep-ejemplo.us-east-1.aws.neon.tech/neondb";

/** Las advertencias que emite el proceso por `fn` (`emitWarning` las entrega en el tick siguiente). */
async function warningsDuring(fn: () => void): Promise<string[]> {
  const seen: string[] = [];
  const listener = (warning: Error) => seen.push(warning.message);
  process.on("warning", listener);
  try {
    fn();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("warning", listener);
  }
  return seen;
}

describe("F12 sslmode for node-postgres and libpq", () => {
  it("adds sslrootcert=system only for libpq and only with verify-full", () => {
    const full = `${BASE}?sslmode=verify-full&channel_binding=require`;
    const forLibpq = new URL(libpqUrl(full));
    expect(forLibpq.searchParams.get("sslrootcert")).toBe("system");
    expect(forLibpq.searchParams.get("sslmode")).toBe("verify-full");
    expect(forLibpq.searchParams.get("channel_binding")).toBe("require");
    expect(forLibpq.username).toBe("usuario");
    expect(forLibpq.password).toBe("cl%40ve");
    expect(forLibpq.pathname).toBe("/neondb");
    // Lo demás queda como estaba.
    for (const url of [
      `${BASE}?sslmode=require`,
      `${BASE}?sslmode=verify-full&sslrootcert=/etc/ssl/neon.pem`,
      "postgres://postgres@127.0.0.1:54329/postgres",
    ])
      expect(libpqUrl(url)).toBe(new URL(url).href);
  });

  it("node-postgres takes verify-full without the warning, and would break with sslrootcert=system", async () => {
    // `pg` no se conecta al crear el cliente: solo interpreta la cadena.
    expect(
      await warningsDuring(
        () => new pg.Client({ connectionString: `${BASE}?sslmode=verify-full` }),
      ),
    ).toEqual([]);
    // Verificación negativa: con `require` (la cadena que da Neon) llega la advertencia de producción
    // (`pg` la emite una vez por proceso).
    const warned = await warningsDuring(
      () => new pg.Client({ connectionString: `${BASE}?sslmode=require` }),
    );
    expect(warned.join(" ")).toMatch(/sslmode=verify-full/);
    // Y con `system` en DATABASE_URL, node-postgres buscaría ese archivo.
    expect(
      () => new pg.Client({ connectionString: libpqUrl(`${BASE}?sslmode=verify-full`) }),
    ).toThrow(/ENOENT/);
  });
});
