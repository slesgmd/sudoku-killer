// Detector de un dominio propio en un texto (R-41): lo usan T-41.5 y T-45.1.
const RESERVED = /\.example$/i;

/** Los hosts internacionalizados de un texto que no son de ejemplo. */
export function customHosts(text: string): string[] {
  const punycode = text.match(/\bxn--[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) ?? [];
  const unicode = [...text.matchAll(/\b(?:https?|wss?):\/\/([\p{L}\p{N}.-]+)/gu)]
    .map((match) => match[1] ?? "")
    .filter((host) => /\P{ASCII}/u.test(host));
  return [...punycode, ...unicode].filter((host) => !RESERVED.test(host));
}
