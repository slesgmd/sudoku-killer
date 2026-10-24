// Elección del puzzle de una partida (R-21, D9): al azar dentro de la dificultad, sin repetir los que
// ya se jugaron en la sala. Si ya se jugaron todos, el que se jugó hace más tiempo (T-21.2).
import type { Rng } from "@sudoku-killer/engine";

/**
 * `available`: los `id` vigentes de la dificultad, en un orden estable (para que la misma semilla dé
 * el mismo puzzle). `played`: los `id` que jugó la sala, en orden de juego, de cualquier dificultad.
 * Devuelve `null` si no hay ninguno disponible.
 */
export function pickPuzzle(
  available: readonly string[],
  played: readonly string[],
  rng: Rng,
): string | null {
  if (available.length === 0) return null;
  const lastPlayed = new Map<string, number>();
  played.forEach((id, index) => lastPlayed.set(id, index));
  const fresh = available.filter((id) => !lastPlayed.has(id));
  if (fresh.length > 0) return fresh[rng.int(fresh.length)] ?? null;
  let oldest: string | null = null;
  let oldestIndex = Infinity;
  for (const id of available) {
    const index = lastPlayed.get(id) ?? -1;
    if (index < oldestIndex) {
      oldest = id;
      oldestIndex = index;
    }
  }
  return oldest;
}
