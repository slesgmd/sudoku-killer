#!/usr/bin/env node
// Política de commits (job `commit-policy` de la CI). Falla si algún archivo versionado o algún
// mensaje de commit contiene uno de los términos de `commit-policy-patterns.mjs`.
//
// Uso (se pueden combinar):
//   --files                         revisa el contenido y el nombre de los archivos versionados.
//   --range <base>..<head>          revisa los mensajes de los commits del rango (pull request).
//   --push <before> <after> <rama>  revisa los commits de un push: `before..after`; si `before` es
//                                   todo ceros (rama nueva o push forzado) o no existe en el
//                                   repositorio, los commits de `after` que no están en otra rama
//                                   remota.
// Sale con 0 si no encuentra nada, con 1 si encuentra algo y con 2 si el uso es incorrecto.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TERM_PATTERN } from "./commit-policy-patterns.mjs";

const ZERO_SHA = /^0+$/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function commitExists(sha) {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Archivos versionados cuyo nombre o contenido de texto contiene un término (`archivo:línea`). */
export function scanFiles() {
  const findings = [];
  for (const path of git(["ls-files", "-z"]).split("\0").filter(Boolean)) {
    if (TERM_PATTERN.test(path)) findings.push(`${path} (nombre)`);
    let content;
    try {
      content = readFileSync(path);
    } catch {
      continue; // Borrado en el árbol de trabajo sin confirmar.
    }
    if (content.includes(0)) continue; // Binario.
    content
      .toString("utf8")
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (TERM_PATTERN.test(line)) findings.push(`${path}:${String(index + 1)}`);
      });
  }
  return findings;
}

/** Commits de un push: `before..after`, o los que no están en otra rama remota. */
export function pushRevisions(before, after, branch) {
  if (!ZERO_SHA.test(before) && commitExists(before)) {
    return git(["rev-list", `${before}..${after}`]);
  }
  const others = git(["for-each-ref", "--format=%(refname)", "refs/remotes"])
    .split("\n")
    .filter((ref) => ref && !ref.endsWith(`/${branch}`) && !ref.endsWith("/HEAD"));
  return git(["rev-list", after, ...(others.length > 0 ? ["--not", ...others] : [])]);
}

/** Commits de la lista cuyo mensaje contiene un término (`commit <sha>`). */
export function scanCommits(revisions) {
  const findings = [];
  for (const sha of revisions.split("\n").filter(Boolean)) {
    if (TERM_PATTERN.test(git(["show", "-s", "--format=%B", sha]))) {
      findings.push(`commit ${sha.slice(0, 12)}`);
    }
  }
  return findings;
}

function main(args) {
  const findings = [];
  let checks = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--files") {
      findings.push(...scanFiles());
      checks++;
    } else if (arg === "--range" && args[i + 1]) {
      findings.push(...scanCommits(git(["rev-list", args[++i] ?? ""])));
      checks++;
    } else if (arg === "--push" && args[i + 3]) {
      const [before = "", after = "", branch = ""] = args.slice(i + 1, i + 4);
      findings.push(...scanCommits(pushRevisions(before, after, branch)));
      i += 3;
      checks++;
    } else {
      console.error(`Argumento no válido: ${String(arg)}`);
      return 2;
    }
  }
  if (checks === 0) {
    console.error(
      "Uso: commit-policy.mjs [--files] [--range <a>..<b>] [--push <antes> <después> <rama>]",
    );
    return 2;
  }
  if (findings.length > 0) {
    console.error("Se encontraron términos prohibidos en:");
    for (const finding of findings) console.error(`  ${finding}`);
    return 1;
  }
  console.log("Sin términos prohibidos.");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
