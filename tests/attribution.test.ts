// Hook commit-msg y guardia de atribuciones (CONTEXTO.md, "Convenciones"). Los fixtures están en
// base64, como los términos de `scripts/attribution-patterns.mjs`, para que una búsqueda en el
// repositorio no los encuentre.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRIP = join(ROOT, "scripts", "strip-attribution.mjs");
const GUARD = join(ROOT, "scripts", "attribution-guard.mjs");

const decode = (encoded: string): string => Buffer.from(encoded, "base64").toString("utf8");

/** Mensaje con un coautor humano y las cuatro líneas de atribución que quita el hook. */
const MESSAGE = decode(
  "ZmVhdDogYWRkIHRoZSBib2FyZAoKQm9keSBsaW5lLgoKQ28tQXV0aG9yZWQtQnk6IEphbmUgRG9lIDxqYW5lQGV4YW1wbGUuY29tPgpDby1BdXRob3JlZC1CeTogQ2xhdWRlIE9wdXMgPG5vcmVwbHlAYW50aHJvcGljLmNvbT4KQ2xhdWRlLVNlc3Npb246IDAxMjNhYmNkCkdlbmVyYXRlZCB3aXRoIENsYXVkZSBDb2RlIChodHRwczovL2NsYXVkZS5jb20vY2xhdWRlLWNvZGUpCg==",
);
/** Casos de control: una línea de documento, un mensaje de commit y un nombre de archivo. */
const CONTROL_LINE = decode("Tm90YXM6IGhlY2hvIGNvbiBDaGF0R1BULg==");
const CONTROL_COMMIT = decode("ZG9jczogd3JpdHRlbiB3aXRoIENvcGlsb3Q=");
const CONTROL_PATH = decode("ZG9jcy9HZW1pbmkubWQ=");

function strip(message: string): string {
  return execFileSync(process.execPath, [STRIP], { input: message, encoding: "utf8" });
}

describe("strip-attribution: the commit-msg hook", () => {
  it("removes the attribution lines and keeps the rest, human co-authors included", () => {
    expect(strip(MESSAGE)).toBe(
      "feat: add the board\n\nBody line.\n\nCo-Authored-By: Jane Doe <jane@example.com>\n",
    );
  });

  it("leaves a clean message unchanged", () => {
    expect(strip("fix: keep the cage sums\n\nDetails.\n")).toBe(
      "fix: keep the cage sums\n\nDetails.\n",
    );
  });

  it("rewrites the file it receives as an argument", () => {
    const dir = mkdtempSync(join(tmpdir(), "strip-"));
    try {
      const file = join(dir, "COMMIT_EDITMSG");
      writeFileSync(file, MESSAGE);
      execFileSync(process.execPath, [STRIP, file]);
      expect(readFileSync(file, "utf8")).toBe(strip(MESSAGE));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("attribution-guard: the CI job", () => {
  let repo: string;

  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    }).trim();

  const commit = (path: string, content: string, message: string): string => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
    git("add", path);
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };

  const guard = (...args: string[]): { status: number | null; output: string } => {
    const result = spawnSync(process.execPath, [GUARD, ...args], { cwd: repo, encoding: "utf8" });
    return { status: result.status, output: result.stdout + result.stderr };
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "guard-"));
    git("init", "-q", "-b", "main");
    git("config", "core.autocrlf", "false");
    commit("README.md", "Sudoku killer.\n", "chore: start");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("passes on clean files and commits", () => {
    const base = git("rev-parse", "HEAD");
    commit("docs/notes.md", "Jaulas y sumas.\n", "docs: add notes");
    expect(guard("--files", "--range", `${base}..HEAD`).status).toBe(0);
  });

  it("fails on a tracked file that contains a term, with its line", () => {
    commit("docs/notes.md", `Jaulas.\n${CONTROL_LINE}\n`, "docs: add notes");
    const result = guard("--files");
    expect(result.status).toBe(1);
    expect(result.output).toContain("docs/notes.md:2");
  });

  it("fails on a tracked file whose name contains a term", () => {
    commit(CONTROL_PATH, "Jaulas.\n", "docs: add notes");
    expect(guard("--files").status).toBe(1);
  });

  describe("control case: two commits, only the first one contains the term", () => {
    let base: string;
    let first: string;

    beforeEach(() => {
      base = git("rev-parse", "HEAD");
      first = commit("a.md", "a\n", CONTROL_COMMIT);
      commit("b.md", "b\n", "docs: add b");
    });

    it("fails on the pull request range base..head", () => {
      const result = guard("--range", `${base}..HEAD`);
      expect(result.status).toBe(1);
      expect(result.output).toContain(first.slice(0, 12));
    });

    it("fails on the push range before..after", () => {
      expect(guard("--push", base, git("rev-parse", "HEAD"), "main").status).toBe(1);
    });

    it("with a zero before, checks the commits that are not on another remote branch", () => {
      const zero = "0".repeat(40);
      git("update-ref", "refs/remotes/origin/feature", "HEAD");
      git("update-ref", "refs/remotes/origin/other", base);
      expect(guard("--push", zero, "HEAD", "feature").status).toBe(1);

      git("update-ref", "refs/remotes/origin/other", first);
      expect(guard("--push", zero, "HEAD", "feature").status).toBe(0);
    });

    it("with an unknown before (forced push), falls back to the other remote branches", () => {
      git("update-ref", "refs/remotes/origin/other", base);
      expect(guard("--push", "1".repeat(40), "HEAD", "main").status).toBe(1);
    });
  });

  it("rejects a call without checks", () => {
    expect(guard().status).toBe(2);
  });
});
