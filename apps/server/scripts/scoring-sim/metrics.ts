// Métricas de la simulación (F6, `docs/puntuacion.md`, sección de métricas). Todas se calculan
// puntuando los registros, así que cambiar los parámetros no exige volver a simular.
import { DIFFICULTIES, type Difficulty } from "@sudoku-killer/protocol";
import { pointsFor, type ScoringParams } from "@sudoku-killer/scoring";
import { baselineScores } from "./baseline.ts";
import type { GameRecord, PlayedGame } from "./experiments.ts";
import { BOT_KINDS, type BotKind } from "./world.ts";

/** Puntaje de cada asiento y puntos positivos de la partida, con un modelo de puntuación. */
export type Scorer = (
  record: GameRecord,
  game: PlayedGame,
) => {
  readonly scores: readonly number[];
  readonly gained: number;
};

export function ownScorer(params: ScoringParams): Scorer {
  return (record, game) => {
    const scores = new Array<number>(record.bots.length).fill(0);
    let gained = 0;
    for (const event of game.log) {
      const seat = Number(event.playerId);
      let delta: number;
      if (event.type === "correct") {
        delta =
          pointsFor(event.levelToDeduce, params) + params.closureBonus * event.closedUnits.length;
        gained += delta;
      } else if (event.type === "mistake") delta = -params.mistakePenalty;
      else delta = -params.hintPenalty;
      scores[seat] = (scores[seat] ?? 0) + delta;
    }
    return { scores, gained };
  };
}

export const speedScorer: Scorer = (record, game) =>
  baselineScores(game.log, record.difficulty, record.bots.length);

// --- Estadística ---

function ranks(values: readonly number[]): number[] {
  const order = values.map((value, i) => [value, i] as const).sort((a, b) => a[0] - b[0]);
  const result = new Array<number>(values.length).fill(0);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.[0] === order[i]?.[0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) result[order[k]?.[1] ?? 0] = rank;
    i = j + 1;
  }
  return result;
}

function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - mx;
    const dy = (y[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
}

export function spearman(x: readonly number[], y: readonly number[]): number {
  return pearson(ranks(x), ranks(y));
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length;

// --- Métricas ---

export interface StratumCorrelation {
  readonly difficulty: Difficulty;
  readonly size: number;
  readonly n: number;
  readonly rho: number;
}

export interface CorrelationMetrics {
  readonly strata: readonly StratumCorrelation[];
  /** El mínimo entre los estratos con al menos `MIN_STRATUM` observaciones. */
  readonly minRho: number;
  readonly pooled: number;
  /** Pares de jugadores de una misma partida ordenados igual por aporte y por puntaje. */
  readonly concordance: number;
  /** Partidas del bloque A sin victoria, que no tienen aporte. */
  readonly excludedGames: number;
}

export const MIN_STRATUM = 100;

/**
 * Aporte de cada asiento, normalizado por el tiempo del equipo: la media sobre las réplicas de
 * (T sin él − T) / T. `null` si la partida no tiene réplicas ganadas (o el asiento no se midió).
 */
export function contributionOf(
  record: GameRecord,
  replicates: readonly number[] | null = null,
): (number | null)[] | null {
  const list = (record.aporte ?? []).filter(
    (_, r) => replicates === null || replicates.includes(r),
  );
  if (list.length === 0) return null;
  return record.bots.map((_, seat) => {
    let sum = 0;
    for (const { end, withoutSeat } of list) {
      const t = withoutSeat[seat];
      if (t === null || t === undefined) return null;
      sum += (t - end) / end;
    }
    return sum / list.length;
  });
}

/** Aporte real (tiempo que el equipo pierde sin el jugador) contra puntaje, ambos normalizados. */
export function correlation(records: readonly GameRecord[], scorer: Scorer): CorrelationMetrics {
  const strata = new Map<
    string,
    { difficulty: Difficulty; size: number; a: number[]; s: number[] }
  >();
  const pooledA: number[] = [];
  const pooledS: number[] = [];
  let agree = 0;
  let pairs = 0;
  let excludedGames = 0;
  for (const record of records) {
    if (record.block !== "A") continue;
    const measured = contributionOf(record);
    if (!measured || measured.some((a) => a === null)) {
      excludedGames++;
      continue;
    }
    const contribution = measured.map((a) => a ?? 0);
    const { scores, gained } = scorer(record, record.full);
    const share = scores.map((s) => s / gained);
    const key = `${record.difficulty}:${String(record.bots.length)}`;
    let stratum = strata.get(key);
    if (!stratum) {
      stratum = { difficulty: record.difficulty, size: record.bots.length, a: [], s: [] };
      strata.set(key, stratum);
    }
    stratum.a.push(...contribution);
    stratum.s.push(...share);
    pooledA.push(...contribution);
    pooledS.push(...share);
    for (let i = 0; i < contribution.length; i++) {
      for (let j = i + 1; j < contribution.length; j++) {
        const da = (contribution[i] ?? 0) - (contribution[j] ?? 0);
        const ds = (share[i] ?? 0) - (share[j] ?? 0);
        if (da === 0) continue;
        pairs++;
        agree += ds === 0 ? 0.5 : Math.sign(da) === Math.sign(ds) ? 1 : 0;
      }
    }
  }
  const list = [...strata.values()]
    .map(({ difficulty, size, a, s }) => ({ difficulty, size, n: a.length, rho: spearman(a, s) }))
    .sort(
      (x, y) =>
        DIFFICULTIES.indexOf(x.difficulty) - DIFFICULTIES.indexOf(y.difficulty) || x.size - y.size,
    );
  const eligible = list.filter(({ n }) => n >= MIN_STRATUM).map(({ rho }) => rho);
  return {
    strata: list,
    minRho: eligible.length === 0 ? NaN : Math.min(...eligible),
    pooled: spearman(pooledA, pooledS),
    concordance: pairs === 0 ? NaN : agree / pairs,
    excludedGames,
  };
}

export interface DuelMetrics {
  readonly games: number;
  /** Duelos en que el aporte del veloz supera al del lógico (con el aporte medido). */
  readonly fastAporteRate: number;
  /** Duelos en que el ganador por puntaje es también el de mayor aporte. */
  readonly agreement: number;
  /** El veloz suma estrictamente más que el lógico de igual velocidad. */
  readonly fastWinRate: number;
  readonly tieRate: number;
  readonly byDifficulty: Readonly<Record<Difficulty, number>>;
}

export function duels(records: readonly GameRecord[], scorer: Scorer): DuelMetrics {
  let games = 0;
  let wins = 0;
  let ties = 0;
  let measured = 0;
  let fastAporte = 0;
  let agree = 0;
  const by = Object.fromEntries(DIFFICULTIES.map((d) => [d, { games: 0, wins: 0 }])) as Record<
    Difficulty,
    { games: number; wins: number }
  >;
  for (const record of records) {
    if (!record.duel) continue;
    const { scores } = scorer(record, record.full);
    const fast = scores[record.duel.fast] ?? 0;
    const logic = scores[record.duel.logic] ?? 0;
    const aporte = contributionOf(record);
    const aFast = aporte?.[record.duel.fast];
    const aLogic = aporte?.[record.duel.logic];
    if (typeof aFast === "number" && typeof aLogic === "number" && aFast !== aLogic) {
      measured++;
      if (aFast > aLogic) fastAporte++;
      if (fast !== logic && fast > logic === aFast > aLogic) agree++;
    }
    games++;
    by[record.difficulty].games++;
    if (fast > logic) {
      wins++;
      by[record.difficulty].wins++;
    } else if (fast === logic) ties++;
  }
  return {
    games,
    fastWinRate: wins / games,
    fastAporteRate: fastAporte / measured,
    agreement: agree / measured,
    tieRate: ties / games,
    byDifficulty: Object.fromEntries(
      DIFFICULTIES.map((d) => [d, by[d].wins / by[d].games]),
    ) as Record<Difficulty, number>,
  };
}

export interface DeltaSummary {
  readonly n: number;
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
  /** Proporción de casos con Δ > 0. */
  readonly positive: number;
  /** Extremo superior del intervalo de confianza del 95 % de la media. */
  readonly upper95: number;
}

export function summarize(deltas: readonly number[]): DeltaSummary {
  const m = mean(deltas);
  const variance =
    deltas.length < 2 ? NaN : deltas.reduce((t, d) => t + (d - m) ** 2, 0) / (deltas.length - 1);
  return {
    n: deltas.length,
    mean: m,
    upper95: m + 1.96 * Math.sqrt(variance / deltas.length),
    p95: quantile(deltas, 0.95),
    max: deltas.length === 0 ? NaN : Math.max(...deltas),
    positive: deltas.filter((d) => d > 0).length / deltas.length,
  };
}

export interface HintMetrics {
  /** Puntaje propio con la pista menos sin ella (todas las ramas, también las de robo). */
  readonly self: DeltaSummary;
  /** Robo: (propio − víctima) con la pista menos (propio − víctima) sin ella. */
  readonly steal: DeltaSummary;
  /** Lo mismo con la rama placebo (la misma espera, sin pista): el ruido de desviar la partida. */
  readonly placeboSelf: DeltaSummary;
  readonly placeboSteal: DeltaSummary;
  /** Efecto neto de la pista, rama por rama: Δ con la pista menos Δ con el placebo. */
  readonly netSelf: DeltaSummary;
  readonly netSteal: DeltaSummary;
}

export function hints(records: readonly GameRecord[], scorer: Scorer): HintMetrics {
  const self: number[] = [];
  const steal: number[] = [];
  const placeboSelf: number[] = [];
  const placeboSteal: number[] = [];
  for (const record of records) {
    const { hint } = record;
    if (!hint) continue;
    const without = scorer(record, record.full).scores;
    const branches = [
      [scorer(record, hint.withHint).scores, self, steal],
      [scorer(record, hint.placebo).scores, placeboSelf, placeboSteal],
    ] as const;
    for (const [scores, selfList, stealList] of branches) {
      const d = (scores[hint.seat] ?? 0) - (without[hint.seat] ?? 0);
      selfList.push(d);
      if (hint.victim === null) continue;
      const v = hint.victim;
      stealList.push(d - ((scores[v] ?? 0) - (without[v] ?? 0)));
    }
  }
  const net = (a: readonly number[], b: readonly number[]) => a.map((x, i) => x - (b[i] ?? 0));
  return {
    self: summarize(self),
    steal: summarize(steal),
    placeboSelf: summarize(placeboSelf),
    placeboSteal: summarize(placeboSteal),
    netSelf: summarize(net(self, placeboSelf)),
    netSteal: summarize(net(steal, placeboSteal)),
  };
}

export interface ShareMetrics {
  readonly median: number;
  readonly p95: number;
}

/** Proporción del total de β en los puntos ganados de cada partida (bloque A). */
export function closureShare(records: readonly GameRecord[], params: ScoringParams): ShareMetrics {
  const shares: number[] = [];
  for (const record of records) {
    if (record.block !== "A") continue;
    let beta = 0;
    let gained = 0;
    for (const event of record.full.log) {
      if (event.type !== "correct") continue;
      const bonus = params.closureBonus * event.closedUnits.length;
      beta += bonus;
      gained += pointsFor(event.levelToDeduce, params) + bonus;
    }
    if (gained > 0) shares.push(beta / gained);
  }
  return { median: quantile(shares, 0.5), p95: quantile(shares, 0.95) };
}

export interface GuessMetrics {
  /** Adivinadores comparados (bloque A, partidas con alguno). */
  readonly guessers: number;
  /**
   * Partida completa: puntaje propio adivinando menos deduciendo (la misma partida con el adivinador
   * pensando la celda en vez de adivinarla). Incluye las vidas perdidas y lo que deja de sumar.
   */
  readonly delta: DeltaSummary;
  /**
   * Episodios: desde la primera adivinanza de un jugador en una celda, la suma de sus puntos en esa
   * celda (errores y el acierto, si es suyo). Es el EV de «probar hasta acertar».
   */
  readonly episodes: DeltaSummary;
  /** Errores por adivinanza. */
  readonly mistakesPerGuess: number;
  readonly guessesPerGuesser: number;
  /** Lo mismo por nivel de técnica del adivinador (2 o 3). */
  readonly bySkill: Readonly<
    Record<number, { readonly delta: DeltaSummary; readonly episodes: DeltaSummary }>
  >;
}

/** Puntos propios de un hecho con los parámetros del modelo propio. */
function ownDelta(event: GameRecord["full"]["log"][number], params: ScoringParams): number {
  if (event.type === "correct") {
    return pointsFor(event.levelToDeduce, params) + params.closureBonus * event.closedUnits.length;
  }
  return event.type === "mistake" ? -params.mistakePenalty : -params.hintPenalty;
}

export function guessing(
  records: readonly GameRecord[],
  scorer: Scorer,
  params: ScoringParams,
): GuessMetrics {
  const deltas: number[] = [];
  const episodes: number[] = [];
  const bySkill = new Map<number, { delta: number[]; episodes: number[] }>();
  const skillList = (skill: number) => {
    let entry = bySkill.get(skill);
    if (!entry) {
      entry = { delta: [], episodes: [] };
      bySkill.set(skill, entry);
    }
    return entry;
  };
  let guesses = 0;
  let guessMistakes = 0;
  for (const record of records) {
    if (record.block === "C") continue;
    const { log } = record.full;
    const started = new Set<string>();
    for (const index of record.full.guesses) {
      const first = log[index];
      if (!first || first.type === "hint") continue;
      const key = `${first.playerId}:${String(first.cell)}`;
      if (started.has(key)) continue;
      started.add(key);
      let sum = 0;
      for (const event of log.slice(index)) {
        if (event.playerId === first.playerId && event.cell === first.cell) {
          sum += ownDelta(event, params);
        }
      }
      episodes.push(sum);
      skillList(record.bots[Number(first.playerId)]?.skill ?? 0).episodes.push(sum);
    }
    if (!record.noGuess) continue;
    const guessed = scorer(record, record.full).scores;
    const deduced = scorer(record, record.noGuess).scores;
    record.bots.forEach((bot, seat) => {
      if (bot.kind !== "guesser") return;
      const d = (guessed[seat] ?? 0) - (deduced[seat] ?? 0);
      deltas.push(d);
      skillList(bot.skill).delta.push(d);
      guesses += record.full.bots[seat]?.guesses ?? 0;
      guessMistakes += record.full.bots[seat]?.guessMistakes ?? 0;
    });
  }
  return {
    guessers: deltas.length,
    delta: summarize(deltas),
    episodes: summarize(episodes),
    mistakesPerGuess: guesses === 0 ? NaN : guessMistakes / guesses,
    guessesPerGuesser: guesses / deltas.length,
    bySkill: Object.fromEntries(
      [...bySkill]
        .sort(([a], [b]) => a - b)
        .map(([skill, x]) => [
          skill,
          { delta: summarize(x.delta), episodes: summarize(x.episodes) },
        ]),
    ),
  };
}

export interface TypicalScore {
  readonly playerMedian: number;
  readonly playerP95: number;
  readonly teamMedian: number;
  readonly teamP95: number;
}

/** Puntaje típico por jugador y por equipo en cada dificultad (bloque A). */
export function typicalScores(
  records: readonly GameRecord[],
  scorer: Scorer,
): Record<Difficulty, TypicalScore> {
  const result = {} as Record<Difficulty, TypicalScore>;
  for (const difficulty of DIFFICULTIES) {
    const players: number[] = [];
    const teams: number[] = [];
    for (const record of records) {
      if (record.block !== "A" || record.difficulty !== difficulty) continue;
      const { scores } = scorer(record, record.full);
      players.push(...scores);
      teams.push(scores.reduce((a, b) => a + b, 0));
    }
    result[difficulty] = {
      playerMedian: quantile(players, 0.5),
      playerP95: quantile(players, 0.95),
      teamMedian: quantile(teams, 0.5),
      teamP95: quantile(teams, 0.95),
    };
  }
  return result;
}

export interface DefeatMetrics {
  readonly byDifficulty: Readonly<
    Record<
      Difficulty,
      { readonly games: number; readonly defeats: number; readonly stalled: number }
    >
  >;
  readonly byKind: Readonly<
    Record<
      BotKind,
      {
        readonly bots: number;
        /** Bots que terminaron sin vidas (espectadores). */
        readonly eliminated: number;
        readonly gamesWith: number;
        readonly defeatsWith: number;
      }
    >
  >;
}

/** Derrotas (todos espectadores) en las partidas completas de los bloques A y B. */
export function defeats(records: readonly GameRecord[]): DefeatMetrics {
  const byDifficulty = Object.fromEntries(
    DIFFICULTIES.map((d) => [d, { games: 0, defeats: 0, stalled: 0 }]),
  ) as Record<Difficulty, { games: number; defeats: number; stalled: number }>;
  const byKind = Object.fromEntries(
    BOT_KINDS.map((k) => [k, { bots: 0, eliminated: 0, gamesWith: 0, defeatsWith: 0 }]),
  ) as Record<
    BotKind,
    { bots: number; eliminated: number; gamesWith: number; defeatsWith: number }
  >;
  for (const record of records) {
    if (record.block === "C") continue;
    const { outcome, bots } = record.full;
    const entry = byDifficulty[record.difficulty];
    entry.games++;
    if (outcome === "defeat") entry.defeats++;
    if (outcome === "stalled") entry.stalled++;
    const kinds = new Set<BotKind>();
    record.bots.forEach((bot, seat) => {
      const k = byKind[bot.kind];
      k.bots++;
      if ((bots[seat]?.livesLeft ?? 0) === 0) k.eliminated++;
      kinds.add(bot.kind);
    });
    for (const kind of kinds) {
      byKind[kind].gamesWith++;
      if (outcome === "defeat") byKind[kind].defeatsWith++;
    }
  }
  return { byDifficulty, byKind };
}

export interface ReliabilityMetrics {
  /** Spearman entre las réplicas 1 y 2 del aporte de una partida, por estrato. */
  readonly strata: readonly StratumCorrelation[];
  readonly pooled: number;
  /** Réplicas por partida (media). */
  readonly replicates: number;
  /**
   * Confiabilidad estimada de la media de las réplicas (Spearman-Brown) en cada estrato. Su raíz es
   * el techo de la correlación de cualquier puntaje con el aporte medido.
   */
  readonly ofMean: readonly StratumCorrelation[];
}

/**
 * Confiabilidad del aporte: la correlación entre dos réplicas con otro azar del mundo. Si el aporte
 * se correlaciona poco consigo mismo, ningún puntaje puede correlacionarse mucho con él.
 */
export function reliability(records: readonly GameRecord[]): ReliabilityMetrics {
  const strata = new Map<
    string,
    { difficulty: Difficulty; size: number; a: number[]; b: number[] }
  >();
  const pooledA: number[] = [];
  const pooledB: number[] = [];
  let replicates = 0;
  let games = 0;
  for (const record of records) {
    if (record.block !== "A") continue;
    const a = contributionOf(record, [0]);
    const b = contributionOf(record, [1]);
    replicates += record.aporte?.length ?? 0;
    games++;
    if (!a || !b) continue;
    const key = `${record.difficulty}:${String(record.bots.length)}`;
    let stratum = strata.get(key);
    if (!stratum) {
      stratum = { difficulty: record.difficulty, size: record.bots.length, a: [], b: [] };
      strata.set(key, stratum);
    }
    const left = a.map((x) => x ?? 0);
    const right = b.map((x) => x ?? 0);
    stratum.a.push(...left);
    stratum.b.push(...right);
    pooledA.push(...left);
    pooledB.push(...right);
  }
  const list = [...strata.values()]
    .map(({ difficulty, size, a, b }) => ({ difficulty, size, n: a.length, rho: spearman(a, b) }))
    .sort(
      (x, y) =>
        DIFFICULTIES.indexOf(x.difficulty) - DIFFICULTIES.indexOf(y.difficulty) || x.size - y.size,
    );
  const k = games === 0 ? 0 : replicates / games;
  return {
    strata: list,
    pooled: spearman(pooledA, pooledB),
    replicates: k,
    ofMean: list.map((x) => ({ ...x, rho: (k * x.rho) / (1 + (k - 1) * x.rho) })),
  };
}

export interface DriftMetrics {
  /** Por tipo de bot: nivel medio al decidir, nivel medio puntuado y aciertos que bajaron de nivel. */
  readonly byKind: Readonly<
    Record<BotKind, { readonly decided: number; readonly scored: number; readonly dropped: number }>
  >;
}

/** Cuánto baja el nivel de una celda mientras se piensa (otros llenan celdas). Bloques A y B. */
export function drift(records: readonly GameRecord[]): DriftMetrics {
  const acc = Object.fromEntries(
    BOT_KINDS.map((k) => [k, { decided: 0, scored: 0, dropped: 0, n: 0 }]),
  ) as Record<BotKind, { decided: number; scored: number; dropped: number; n: number }>;
  for (const record of records) {
    if (record.block === "C") continue;
    record.full.log.forEach((event, i) => {
      const decided = record.full.decidedLevels[i] ?? 0;
      if (event.type !== "correct" || decided === 0) return;
      const kind = record.bots[Number(event.playerId)]?.kind;
      if (!kind) return;
      const entry = acc[kind];
      entry.n++;
      entry.decided += decided;
      entry.scored += event.levelToDeduce;
      if (event.levelToDeduce < decided) entry.dropped++;
    });
  }
  return {
    byKind: Object.fromEntries(
      BOT_KINDS.map((k) => {
        const { decided, scored, dropped, n } = acc[k];
        return [k, { decided: decided / n, scored: scored / n, dropped: dropped / n }];
      }),
    ) as DriftMetrics["byKind"],
  };
}

export interface KindShare {
  /** Cuota media de puntaje, 100 = la parte justa de su mesa (1/n del total). */
  readonly score: number;
  /** Cuota media de aporte, en la misma escala. */
  readonly aporte: number;
  readonly bots: number;
}

export interface EquityMetrics {
  /** Bloque A: por tipo de bot. */
  readonly general: Readonly<Record<BotKind, KindShare>>;
  /** Bloque B: la cuota del veloz dentro del par del duelo (50 = mitad). */
  readonly duel: {
    readonly score: number;
    readonly aporte: number;
    /** Duelos que gana el veloz por puntaje y por aporte, en %. */
    readonly winRate: number;
    readonly aporteWinRate: number;
    readonly games: number;
  };
  /** La mayor diferencia, en puntos, entre cuota de puntaje y de aporte (general y duelo). */
  readonly maxGap: number;
}

const positive = (x: number): number => Math.max(0, x);

/**
 * Equidad: la cuota de puntaje de cada tipo de bot frente a su cuota de aporte. Las cuotas usan las
 * partes positivas (un puntaje negativo cuenta como 0), normalizadas para que 100 sea la parte justa
 * de la mesa; en el duelo, la cuota del veloz dentro del par.
 */
export function equity(records: readonly GameRecord[], scorer: Scorer): EquityMetrics {
  const acc = Object.fromEntries(
    BOT_KINDS.map((k) => [k, { score: 0, aporte: 0, bots: 0 }]),
  ) as Record<BotKind, { score: number; aporte: number; bots: number }>;
  const duel = { score: 0, aporte: 0, wins: 0, aporteWins: 0, games: 0 };
  for (const record of records) {
    if (record.block === "C") continue;
    const measured = contributionOf(record);
    if (!measured) continue;
    const { scores } = scorer(record, record.full);
    if (record.block === "A") {
      if (measured.some((a) => a === null)) continue;
      const sTotal = scores.reduce((t, x) => t + positive(x), 0);
      const aTotal = measured.reduce<number>((t, x) => t + positive(x ?? 0), 0);
      if (sTotal === 0 || aTotal === 0) continue;
      const n = record.bots.length;
      record.bots.forEach((bot, seat) => {
        const entry = acc[bot.kind];
        entry.score += (100 * n * positive(scores[seat] ?? 0)) / sTotal;
        entry.aporte += (100 * n * positive(measured[seat] ?? 0)) / aTotal;
        entry.bots++;
      });
      continue;
    }
    if (!record.duel) continue;
    const { fast, logic } = record.duel;
    const aFast = positive(measured[fast] ?? 0);
    const aLogic = positive(measured[logic] ?? 0);
    const sFast = positive(scores[fast] ?? 0);
    const sLogic = positive(scores[logic] ?? 0);
    if (aFast + aLogic === 0 || sFast + sLogic === 0) continue;
    duel.games++;
    duel.score += (100 * sFast) / (sFast + sLogic);
    duel.aporte += (100 * aFast) / (aFast + aLogic);
    if ((scores[fast] ?? 0) > (scores[logic] ?? 0)) duel.wins++;
    if ((measured[fast] ?? 0) > (measured[logic] ?? 0)) duel.aporteWins++;
  }
  const general = Object.fromEntries(
    BOT_KINDS.map((k) => {
      const { score, aporte, bots } = acc[k];
      return [k, { score: score / bots, aporte: aporte / bots, bots }];
    }),
  ) as Record<BotKind, KindShare>;
  const duelShares = {
    score: duel.score / duel.games,
    aporte: duel.aporte / duel.games,
    winRate: (100 * duel.wins) / duel.games,
    aporteWinRate: (100 * duel.aporteWins) / duel.games,
    games: duel.games,
  };
  const gaps = [
    ...BOT_KINDS.map((k) => Math.abs(general[k].score - general[k].aporte)),
    Math.abs(duelShares.score - duelShares.aporte),
    Math.abs(duelShares.winRate - duelShares.aporteWinRate),
  ];
  return { general, duel: duelShares, maxGap: Math.max(...gaps) };
}

export interface CeilingMetrics {
  /** Por estrato: Spearman con el puntaje, techo (raíz de la confiabilidad de la media) y su razón. */
  readonly strata: readonly {
    readonly difficulty: Difficulty;
    readonly size: number;
    readonly rho: number;
    readonly ceiling: number;
    readonly ratio: number;
  }[];
  /** La menor razón entre los estratos con al menos `MIN_STRATUM` observaciones. */
  readonly minRatio: number;
}

/** Spearman de cada estrato relativo a su techo de confiabilidad. */
export function againstCeiling(
  correlationMetrics: CorrelationMetrics,
  reliable: ReliabilityMetrics,
): CeilingMetrics {
  const strata = correlationMetrics.strata.flatMap((x) => {
    const mean = reliable.ofMean.find((m) => m.difficulty === x.difficulty && m.size === x.size);
    if (!mean) return [];
    const ceiling = Math.sqrt(Math.max(0, mean.rho));
    return [
      {
        difficulty: x.difficulty,
        size: x.size,
        rho: x.rho,
        ceiling,
        ratio: x.rho / ceiling,
        n: x.n,
      },
    ];
  });
  const eligible = strata.filter(({ n }) => n >= MIN_STRATUM).map(({ ratio }) => ratio);
  return {
    strata: strata.map(({ difficulty, size, rho, ceiling, ratio }) => ({
      difficulty,
      size,
      rho,
      ceiling,
      ratio,
    })),
    minRatio: eligible.length === 0 ? NaN : Math.min(...eligible),
  };
}

export interface Metrics {
  readonly correlation: CorrelationMetrics;
  readonly equity: EquityMetrics;
  readonly duels: DuelMetrics;
  readonly hints: HintMetrics;
  readonly closureShare: ShareMetrics;
  readonly guessing: GuessMetrics;
  readonly typical: Record<Difficulty, TypicalScore>;
}

export function evaluate(
  records: readonly GameRecord[],
  scorer: Scorer,
  params: ScoringParams,
): Metrics {
  return {
    correlation: correlation(records, scorer),
    equity: equity(records, scorer),
    duels: duels(records, scorer),
    hints: hints(records, scorer),
    closureShare: closureShare(records, params),
    guessing: guessing(records, scorer, params),
    typical: typicalScores(records, scorer),
  };
}
