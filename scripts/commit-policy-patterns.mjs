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

/** Decodifica un texto en base64. */
function decode(encoded) {
  return Buffer.from(encoded, "base64").toString("utf8");
}

const ALTERNATION = ENCODED_TERMS.map(decode).join("|");

/** Cualquiera de los términos, sin distinguir mayúsculas. */
export const TERM_PATTERN = new RegExp(ALTERNATION, "i");

/** Líneas que el hook quita del mensaje de commit. */
export const STRIP_PATTERNS = [
  new RegExp(`^\\s*Co-Authored-By:.*(${ALTERNATION})`, "i"),
  new RegExp(`^\\s*(${ALTERNATION})-Session:`, "i"),
  /Generated with/i,
  new RegExp(`(${ALTERNATION})\\.(com|ai)\\b`, "i"),
];
