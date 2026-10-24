// Azar del servidor (SPEC §8.2): el código de sala y la elección del puzzle usan un `Rng`, y los
// identificadores un `IdGenerator`. En producción salen de `node:crypto`; en las pruebas, de una
// semilla. Las fichas no pasan por aquí: siempre usan `node:crypto` (`tokens.ts`).
import { randomInt, randomUUID } from "node:crypto";
import type { Rng } from "@sudoku-killer/engine";

const TWO_32 = 0x1_0000_0000;

export const systemRandom: Rng = {
  next: () => randomInt(0, TWO_32),
  int: (bound) => randomInt(0, bound),
};

/** Identificadores opacos: jugadores y partidas. Las partidas necesitan un UUID (tabla `matches`). */
export type IdGenerator = () => string;

export const systemIds: IdGenerator = () => randomUUID();

/** UUID con la forma de la versión 4, sacado de un generador con semilla (para las pruebas). */
export function seededIds(rng: Rng): IdGenerator {
  return () => {
    const hex = Array.from({ length: 4 }, () => rng.next().toString(16).padStart(8, "0")).join("");
    const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
}
