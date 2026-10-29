// Estado de una partida (SPEC §2.3, ADR 0004). Es lo que el reductor reconstruye desde el registro:
// nunca guarda la solución, que solo conoce quien decide las jugadas (`decide.ts`).
import type {
  Connection,
  LockSource,
  NoteLayer,
  NoteOp,
  PublicPuzzle,
  Role,
  Settings,
} from "@sudoku-killer/protocol";

export type PlayerId = string;

export interface MatchPlayer {
  readonly id: PlayerId;
  readonly nickname: string;
  /** 0..5; null si salió o expiró (SPEC §3.2). */
  readonly seat: number | null;
  readonly joinedAt: number;
  readonly tokenHash: string;
  readonly connection: Connection;
  readonly settings: Settings;
  readonly role: Role;
  readonly lives: number;
  readonly score: number;
  readonly mistakes: number;
  /** Último cambio de puntaje, para el desempate (R-02). */
  readonly scoreReachedAt: number | null;
  /** Una máscara por celda (R-29: solo la ve su dueño). */
  readonly personalNotes: Uint16Array;
}

export type CellState =
  | { readonly status: "empty" }
  | {
      readonly status: "locked";
      readonly value: number;
      readonly source: LockSource;
      readonly by: PlayerId | null;
      /** 0 en los números iniciales. */
      readonly seq: number;
    };

/** Una operación de notas aplicada, para el deshacer con comprobación (P7, ADR 0005). */
export interface NoteRecord {
  readonly layer: NoteLayer;
  /** Dueño de la capa personal; null en la grupal. */
  readonly ownerId: PlayerId | null;
  /** Quien hizo la operación. */
  readonly playerId: PlayerId;
  readonly cell: number;
  readonly digit: number;
  readonly op: NoteOp;
}

export interface Exclusion {
  readonly cell: number;
  readonly digit: number;
}

export interface MatchState {
  readonly id: string;
  readonly puzzle: PublicPuzzle;
  readonly modeId: string;
  readonly scoringParamsVersion: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly result: "victory" | "defeat" | null;
  /** Último `seq` aplicado (ADR 0004). */
  readonly seq: number;
  readonly starterId: PlayerId | null;
  readonly cells: readonly CellState[];
  readonly groupNotes: Uint16Array;
  readonly hintsLeft: number;
  /** Dígitos de los errores (públicos), para `levelToDeduce`. Sin repetir. */
  readonly excluded: readonly Exclusion[];
  /** Clave de candidato (`noteKey`) → `seq` de su última modificación (P7). */
  readonly lastNoteOp: ReadonlyMap<string, number>;
  /** `seq` de cada operación de notas → la operación. */
  readonly noteOps: ReadonlyMap<number, NoteRecord>;
  /** En orden de entrada. */
  readonly players: ReadonlyMap<PlayerId, MatchPlayer>;
}
