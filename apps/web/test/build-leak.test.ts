// T-31.2: el build de producción del cliente no incluye el servidor simulado ni ninguna solución.
// El detector (`scripts/check-dist.ts`) tiene que fallar con el fixture de control, y el build real
// (el mismo de `pnpm build`, en una carpeta temporal) tiene que quedar limpio.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { checkDist, findModuleLeaks, findTextLeaks } from "../scripts/check-dist.ts";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("fixtures/leaky-dist", import.meta.url));

describe("T-31.2 the detector fails on the control fixture", () => {
  it("finds every forbidden text pattern", () => {
    const rules = new Set(findTextLeaks(FIXTURE).map((finding) => finding.rule));
    expect([...rules].sort()).toEqual([
      "manifest key",
      "serialized solution",
      "simulator marker",
      "solution array",
      "solution field",
    ]);
  });

  it("finds simulator, bank, manifest and engine modules outside the client allowlist", () => {
    const findings = findModuleLeaks({
      "assets/index.js": [
        "/repo/apps/web/src/main.tsx",
        "/repo/apps/web/src/dev/sim/server.ts",
        "/repo/packages/bank/src/regenerate.ts",
        "/repo/apps/server/bank/manifest.json",
        "/repo/packages/engine/src/generator/generate.ts",
        "/repo/packages/engine/src/solver-a/solve.ts",
        "/repo/packages/engine/src/grader/grade.ts",
        "/repo/packages/game/src/decide.ts",
        "/repo/packages/engine/src/model/geometry.ts",
        "/repo/packages/game/src/client.ts",
      ],
    });
    expect(findings.map((f) => f.detail.replace(/^\/repo\//, ""))).toEqual([
      "apps/web/src/dev/sim/server.ts",
      "packages/bank/src/regenerate.ts",
      "packages/bank/src/regenerate.ts",
      "apps/server/bank/manifest.json",
      "packages/engine/src/generator/generate.ts",
      "packages/engine/src/solver-a/solve.ts",
      "packages/engine/src/grader/grade.ts",
      "packages/game/src/decide.ts",
    ]);
  });

  it("a build without its module report fails", () => {
    expect(checkDist(FIXTURE).map((f) => f.rule)).toContain("missing module report");
  });
});

describe("T-31.2 the production build is clean", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sk-web-build-"));
  const outDir = path.join(root, "dist");
  const nodeEnv = process.env["NODE_ENV"];

  /** Vite decide `import.meta.env.DEV` con `NODE_ENV`, que Vitest pone en `test`. */
  async function buildWith(env: "production" | "development"): Promise<void> {
    process.env["NODE_ENV"] = env;
    try {
      await build({
        root: WEB_ROOT,
        configFile: path.join(WEB_ROOT, "vite.config.ts"),
        mode: env,
        logLevel: "silent",
        build: { outDir, emptyOutDir: true },
      });
    } finally {
      process.env["NODE_ENV"] = nodeEnv;
    }
  }

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("has no simulator module, no manifest and no solution", { timeout: 120_000 }, async () => {
    await buildWith("production");
    expect(checkDist(outDir)).toEqual([]);
  });

  it(
    "the manifest alias does not exist in a build: a build that keeps the simulator fails",
    {
      timeout: 120_000,
    },
    async () => {
      await expect(buildWith("development")).rejects.toThrow(/@dev\/bank-manifest/);
    },
  );
});
