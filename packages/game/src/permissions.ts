// Reglas y permisos del modo Normal (SPEC §5). No importa nada más del paquete: el cliente los usa
// para mostrar qué está disponible (`@sudoku-killer/game/client`).
import type { Role } from "@sudoku-killer/protocol";

export type Action = "place" | "hint" | "note.personal" | "note.group" | "note.undo" | "presence";

export interface ModeRules {
  readonly maxSeats: number;
  readonly initialLives: number;
  readonly teamHints: number;
  readonly graceMs: number;
  readonly allowMidMatchJoin: boolean;
}

export const NORMAL_RULES: ModeRules = Object.freeze({
  maxSeats: 6,
  initialLives: 3,
  teamHints: 3,
  graceMs: 120_000,
  allowMidMatchJoin: true,
});

/** `active` puede todo; `spectator`, solo notas, deshacer sus notas y presencia (R-23). */
export function normalCan(role: Role, action: Action): boolean {
  return role === "active" || (action !== "place" && action !== "hint");
}
