// Ranking de una partida (R-02, SPEC §5): puntaje descendente; a igual puntaje, menos errores;
// después, menor `scoreReachedAt`. Si todo empata, comparten posición y se muestran por apodo.

export interface RankingInput<P extends string = string> {
  readonly playerId: P;
  readonly nickname: string;
  readonly score: number;
  readonly mistakes: number;
  /** `null` si su puntaje nunca cambió: va después de cualquier tiempo. */
  readonly scoreReachedAt: number | null;
}

export interface RankedEntry<P extends string = string> extends RankingInput<P> {
  /** Desde 1. Los empatados comparten la posición, y la siguiente salta (1, 1, 3). */
  readonly position: number;
}

function compareRank(a: RankingInput, b: RankingInput): number {
  return (
    b.score - a.score ||
    a.mistakes - b.mistakes ||
    (a.scoreReachedAt ?? Infinity) - (b.scoreReachedAt ?? Infinity) ||
    0
  );
}

function compareDisplay(a: RankingInput, b: RankingInput): number {
  return (
    a.nickname.localeCompare(b.nickname, "es", { sensitivity: "base" }) ||
    (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
  );
}

export function rankPlayers<P extends string>(
  entries: readonly RankingInput<P>[],
): RankedEntry<P>[] {
  const sorted = [...entries].sort((a, b) => compareRank(a, b) || compareDisplay(a, b));
  const ranked: RankedEntry<P>[] = [];
  sorted.forEach((entry, i) => {
    const previous = ranked[i - 1];
    const position = previous && compareRank(previous, entry) === 0 ? previous.position : i + 1;
    ranked.push({ ...entry, position });
  });
  return ranked;
}
