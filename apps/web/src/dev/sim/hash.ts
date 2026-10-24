// Hash del puzzle con la API del navegador (`crypto.subtle`): el mismo que calcula el servidor con
// `node:crypto` para el manifiesto (primeros 16 dígitos hexadecimales del SHA-256 de
// `canonicalPuzzle`). Una prueba comprueba que coinciden.
export async function puzzleHashSubtle(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
