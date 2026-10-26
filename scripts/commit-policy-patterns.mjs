// Términos que no pueden aparecer en el repositorio. Están en base64 para que una búsqueda en el
// árbol no los encuentre en este archivo. Los usan el hook commit-msg (`commit-msg-filter.mjs`) y
// el job `commit-policy` de la CI (`commit-policy.mjs`).

const ENCODED_TERMS = [
  "Y2xhdWRl",
  "YW50aHJvcGlj",
  "Z2VtaW5p",
  "Y2hhdGdwdA==",
  "b3BlbmFp",
  "Y29waWxvdA==",
];

/** Única frase permitida, exacta (con mayúsculas), y solo en el contenido de `ALLOWED_FILES`. */
const ENCODED_ALLOWED_PHRASE = "Q2xhdWRlIERlc2lnbg==";

/** Decodifica un texto en base64. */
function decode(encoded) {
  return Buffer.from(encoded, "base64").toString("utf8");
}

const ALTERNATION = ENCODED_TERMS.map(decode).join("|");

/** Cualquiera de los términos, sin distinguir mayúsculas. */
export const TERM_PATTERN = new RegExp(ALTERNATION, "i");

/** Archivos versionados donde se permite la frase exacta (nunca en nombres ni en commits). */
export const ALLOWED_FILES = new Set(["docs/diseno.md", "README.md", "README.es.md"]);

const ALLOWED_PHRASE = new RegExp(`\\b${decode(ENCODED_ALLOWED_PHRASE)}\\b`, "g");

/** La línea de `path` sin las apariciones permitidas, para buscar en ella los términos. */
export function withoutAllowedPhrase(path, line) {
  return ALLOWED_FILES.has(path) ? line.replace(ALLOWED_PHRASE, " ") : line;
}

/** Líneas que el hook quita del mensaje de commit. */
export const STRIP_PATTERNS = [
  new RegExp(`^\\s*Co-Authored-By:.*(${ALTERNATION})`, "i"),
  new RegExp(`^\\s*(${ALTERNATION})-Session:`, "i"),
  /Generated with/i,
  new RegExp(`(${ALTERNATION})\\.(com|ai)\\b`, "i"),
];
