// Cuántos eventos sin tope natural lleva una partida (SPEC R-40, `docs/seguridad.md` S-09). Los demás
// tipos del registro ya tienen el suyo: `match.started` y `match.ended`, uno; `cell.solved`, uno por
// celda; `hint.used`, las pistas del equipo; `cell.mistake`, las vidas de cada jugador; y
// `starter.changed`, una por cada salida. Se cuenta sobre los eventos, sin tocar el reductor ni el
// registro: tras un reinicio se reconstruye contando el registro confirmado (T-32.2).
import type { MatchEvent } from "@sudoku-killer/game";

export interface MatchCaps {
  /** `note.op` y `settings.changed` por jugador. */
  readonly notesPerPlayer: number;
  /** `player.joined`: jugadores que entran con la partida en curso. */
  readonly joinsPerMatch: number;
  /** `player.connection` por jugador. */
  readonly connectionsPerPlayer: number;
}

export class MatchUsage {
  joins = 0;
  private readonly notes = new Map<string, number>();
  private readonly connections = new Map<string, number>();

  count(event: MatchEvent): void {
    switch (event.type) {
      case "note.op":
      case "settings.changed":
        this.add(this.notes, event.payload.playerId);
        return;
      case "player.joined":
        this.joins++;
        return;
      case "player.connection":
        this.add(this.connections, event.payload.playerId);
        return;
      default:
    }
  }

  notesOf(playerId: string): number {
    return this.notes.get(playerId) ?? 0;
  }

  connectionsOf(playerId: string): number {
    return this.connections.get(playerId) ?? 0;
  }

  private add(counts: Map<string, number>, playerId: string): void {
    counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
  }
}
