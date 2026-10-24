// Reglas de forma de la sala que comparten el servidor, el servidor simulado y el cliente (SPEC D2):
// el alfabeto del código de sala y la validez y la unicidad del apodo.

/** Sin 0, O, 1, I ni L, para que el código se dicte sin confusiones (D2). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;

/** El apodo tal como se guarda y se muestra: NFKC y sin espacios en los extremos. */
export function normalizeNickname(nickname: string): string {
  return nickname.normalize("NFKC").trim();
}

/** Clave de unicidad del apodo en la sala: sin distinguir mayúsculas (D2, T-09.2). */
export function nicknameKey(nickname: string): string {
  return normalizeNickname(nickname).toLowerCase();
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** De 2 a 16 caracteres (grafemas, como los ve una persona) después de normalizar (D2, T-09.3). */
export function isValidNickname(nickname: string): boolean {
  const length = Array.from(graphemes.segment(normalizeNickname(nickname))).length;
  return length >= NICKNAME_MIN_LENGTH && length <= NICKNAME_MAX_LENGTH;
}

const ROOM_CODE_SHAPE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${String(ROOM_CODE_LENGTH)}}$`, "i");

/** Un código con la forma de D2, en mayúsculas o minúsculas. */
export function isRoomCodeShape(code: string): boolean {
  return ROOM_CODE_SHAPE.test(code);
}
