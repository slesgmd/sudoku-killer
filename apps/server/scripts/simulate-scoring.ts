// Simulación Monte Carlo de la puntuación (F6, `docs/puntuacion.md`): juega partidas con bots sobre
// los puzzles del banco, las puntúa con los parámetros vigentes y con el modelo de velocidad, e
// imprime las métricas objetivo. Escribe el informe completo en JSON.
//
//   pnpm --filter @sudoku-killer/server scoring:simulate [--games 10000] [--base-seed 1]
//     [--workers N] [--robustness-every 4] [--params archivo.json] [--out carpeta]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DIFFICULTIES } from "@sudoku-killer/protocol";
import {
  PARAMS_V1,
  parseScoringParams,
  pointsFor,
  type ScoringParams,
} from "@sudoku-killer/scoring";
import { manifestSchema } from "@sudoku-killer/bank";
import {
  drift,
  reliability,
  defeats,
  evaluate,
  ownScorer,
  speedScorer,
  type DeltaSummary,
  type Metrics,
} from "./scoring-sim/metrics.ts";
import type { GameRecord } from "./scoring-sim/experiments.ts";
import { runSimulation } from "./scoring-sim/run.ts";
import { checkTargets, fastLogicGap, type Check } from "./scoring-sim/targets.ts";
import { TIME_PROFILES, worldModel, type ProfileName } from "./scoring-sim/world.ts";

const { values } = parseArgs({
  options: {
    games: { type: "string", default: "10000" },
    "base-seed": { type: "string", default: "1" },
    workers: { type: "string", default: String(Math.max(1, availableParallelism() - 1)) },
    "robustness-every": { type: "string", default: "4" },
    replicates: { type: "string", default: "4" },
    params: { type: "string" },
    out: { type: "string", default: join(tmpdir(), "sudoku-killer-scoring-sim") },
  },
});

const manifest = manifestSchema.parse(
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../bank/manifest.json", import.meta.url)), "utf8"),
  ),
);
const params: ScoringParams = values.params
  ? parseScoringParams(JSON.parse(readFileSync(values.params, "utf8")))
  : PARAMS_V1;
const games = Number(values.games);
const baseSeed = Number(values["base-seed"]);

const f = (x: number, digits = 2): string => (Number.isFinite(x) ? x.toFixed(digits) : String(x));
const pct = (x: number): string => `${f(100 * x, 1)} %`;
const delta = (d: DeltaSummary): string =>
  `n ${String(d.n)}, media ${f(d.mean, 1)}, p95 ${f(d.p95, 1)}, máx. ${f(d.max, 1)}, Δ > 0 en ${pct(d.positive)}`;

console.log(
  `Simulando ${String(games)} partidas (semilla base ${String(baseSeed)}, ${values.workers} hilos, perfiles alternativos cada ${values["robustness-every"]} puzzles)…`,
);
let lastShown = 0;
const run = await runSimulation({
  manifest,
  games,
  baseSeed,
  robustnessEvery: Number(values["robustness-every"]),
  workers: Number(values.workers),
  replicates: Number(values.replicates),
  onProgress: (done, total) => {
    if (done === total || performance.now() - lastShown > 10_000) {
      lastShown = performance.now();
      console.log(`  ${String(done)}/${String(total)} puzzles`);
    }
  },
});

const byProfile = (profile: ProfileName): GameRecord[] =>
  run.records.filter((record) => record.profile === profile);
const base = byProfile("base");
const simulations = run.records.reduce(
  (total, r) =>
    total +
    1 +
    (r.aporte ?? []).reduce((t, x) => t + x.withoutSeat.filter((w) => w !== null).length + 1, -1) +
    (r.noGuess ? 1 : 0) +
    (r.hint ? 2 : 0),
  0,
);

console.log("\n## Tiempo");
console.log(
  `${String(run.records.length)} partidas registradas (${String(base.length)} con el perfil base), ${String(simulations)} simulaciones con las ramas y el contrafáctico.`,
);
console.log(
  `Reloj: ${f(run.wallMs / 60_000, 1)} min. CPU: regenerar ${f(run.cpuMs.regenerate / 1000, 0)} s, simular ${f(run.cpuMs.simulate / 1000, 0)} s (de los cuales levelsToDeduce ${f(run.cpuMs.analysis / 1000, 0)} s en ${String(run.analyses)} estados, de ${String(run.analysisCalls)} consultas).`,
);
console.log(
  `Por simulación: ${f(run.cpuMs.simulate / simulations, 1)} ms; por estado analizado: ${f(run.cpuMs.analysis / run.analyses, 2)} ms.`,
);

console.log("\n## Puntos por segundo de cada nivel (B·w(L) / tiempo medio de pensar)");
const noise = Math.exp(worldModel("base").thinkSigma ** 2 / 2);
for (const [name, times] of Object.entries(TIME_PROFILES)) {
  const row = times.map((t, i) => f(pointsFor(i + 1, params) / (t * noise), 2));
  console.log(
    `  ${name.padEnd(5)} T = ${times.join("/")} s → ${row.join(" · ")} puntos/s (niveles 1 a 5)`,
  );
}

console.log("\n## Condiciones analíticas");
const [w1, , , w4, w5] = params.weights;
console.log(
  `  Adivinar con k = 2 (descartes públicos): P > B·(w(L) + w(s)), con L el nivel de la celda y s el del punto fijo en que se ven los 2 candidatos. Peor caso L = 5: s = 1 → ${String(params.base * ((w5 ?? 0) + (w1 ?? 0)))}, s = 4 → ${String(params.base * ((w5 ?? 0) + (w4 ?? 0)))}. P = ${String(params.mistakePenalty)}.`,
);
console.log(
  `  Robo con pista: H ≥ V máx. = B·w(5) = ${String(params.base * (w5 ?? 0))}. H = ${String(params.hintPenalty)}.`,
);

function report(title: string, metrics: Metrics): void {
  console.log(`\n## ${title}`);
  const { correlation: c, duels: d, hints: h, closureShare: b, guessing: g, equity: e } = metrics;
  console.log(
    `Equidad, cuotas (100 = parte justa) puntaje / aporte: ${Object.entries(e.general)
      .map(([kind, x]) => `${kind} ${f(x.score, 1)} / ${f(x.aporte, 1)}`)
      .join(
        ", ",
      )}; duelo, cuota del veloz en el par ${f(e.duel.score, 1)} / ${f(e.duel.aporte, 1)}, duelos que gana ${f(e.duel.winRate, 1)} % / ${f(e.duel.aporteWinRate, 1)} %. Diferencia máxima veloz y lógico: ${f(fastLogicGap(metrics), 1)}.`,
  );
  console.log(
    `Spearman aporte–puntaje: mínimo por estrato ${f(c.minRho)}, agrupado ${f(c.pooled)}, concordancia de pares ${pct(c.concordance)} (${String(c.excludedGames)} partidas A sin victoria excluidas).`,
  );
  for (const difficulty of DIFFICULTIES) {
    const row = c.strata
      .filter((s) => s.difficulty === difficulty)
      .map((s) => `${String(s.size)}: ${f(s.rho)} (n ${String(s.n)})`);
    console.log(`  ${difficulty.padEnd(6)} ${row.join(" · ")}`);
  }
  console.log(
    `Duelos veloz contra lógico de igual velocidad: el veloz gana ${pct(d.fastWinRate)} (empates ${pct(d.tieRate)}, ${String(d.games)} duelos). Por dificultad: ${DIFFICULTIES.map((x) => `${x} ${pct(d.byDifficulty[x])}`).join(", ")}. El aporte del veloz es mayor en ${pct(d.fastAporteRate)}; puntaje y aporte eligen al mismo en ${pct(d.agreement)}.`,
  );
  console.log(`Pista, puntaje propio con menos sin: ${delta(h.self)}.`);
  console.log(`Robo, (propio − víctima) con menos sin: ${delta(h.steal)}.`);
  console.log(`  Placebo (la misma espera sin pista): propio ${delta(h.placeboSelf)}.`);
  console.log(`  Placebo del robo: ${delta(h.placeboSteal)}.`);
  console.log(`β en los puntos ganados por partida: mediana ${pct(b.median)}, p95 ${pct(b.p95)}.`);
  console.log(
    `Adivinar contra deducir, partida completa (por adivinador): ${delta(g.delta)}; ${f(g.guessesPerGuesser, 1)} adivinanzas por adivinador, ${pct(g.mistakesPerGuess)} con error.`,
  );
  console.log(
    `Episodios de adivinanza (probar hasta acertar), modelo propio: ${delta(g.episodes)}.`,
  );
  for (const [skill, x] of Object.entries(g.bySkill)) {
    console.log(
      `  Adivinador de nivel ${skill}: frente a deducir ${delta(x.delta)}, IC 95 % superior ${f(x.delta.upper95, 1)}; episodios ${delta(x.episodes)}.`,
    );
  }
  console.log(
    `Efecto neto de la pista (con pista − placebo): propio ${delta(h.netSelf)}; robo ${delta(h.netSteal)}.`,
  );
  console.log("Puntaje típico (mediana / p95): jugador · equipo");
  for (const difficulty of DIFFICULTIES) {
    const t = metrics.typical[difficulty];
    console.log(
      `  ${difficulty.padEnd(6)} ${f(t.playerMedian, 0)} / ${f(t.playerP95, 0)} · ${f(t.teamMedian, 0)} / ${f(t.teamP95, 0)}`,
    );
  }
}

const own = evaluate(base, ownScorer(params), params);
const speed = evaluate(base, speedScorer, params);
report(`Modelo propio (${params.version}), perfil base`, own);
report("Modelo de velocidad, perfil base", speed);

console.log("\n## Vidas y derrotas (bloques A y B, perfil base)");
const lost = defeats(base);
for (const difficulty of DIFFICULTIES) {
  const x = lost.byDifficulty[difficulty];
  console.log(
    `  ${difficulty.padEnd(6)} derrotas ${pct(x.defeats / x.games)} (${String(x.defeats)} de ${String(x.games)}), sin poder seguir ${String(x.stalled)}`,
  );
}
for (const [kind, x] of Object.entries(lost.byKind)) {
  console.log(
    `  ${kind.padEnd(7)} terminan sin vidas ${pct(x.eliminated / x.bots)} de ${String(x.bots)}; derrotas en partidas con alguno ${pct(x.defeatsWith / x.gamesWith)}`,
  );
}

console.log("\n## Confiabilidad del aporte (réplica con otro azar del mundo)");
const reliable = reliability(base);
console.log(
  `  Una réplica contra otra (agrupado ${f(reliable.pooled)}) → media de ${f(reliable.replicates, 1)} réplicas (Spearman-Brown) y su techo para el puntaje (raíz):`,
);
for (const difficulty of DIFFICULTIES) {
  const row = reliable.strata
    .filter((x) => x.difficulty === difficulty)
    .map((x) => {
      const mean = reliable.ofMean.find((m) => m.difficulty === x.difficulty && m.size === x.size);
      return `${String(x.size)}: ${f(x.rho)} → ${f(mean?.rho ?? NaN)} (techo ${f(Math.sqrt(mean?.rho ?? NaN))})`;
    });
  console.log(`  ${difficulty.padEnd(6)} ${row.join(" · ")}`);
}

console.log("\n## Nivel al decidir contra nivel puntuado (aciertos deducidos, bloques A y B)");
const drifted = drift(base);
for (const [kind, x] of Object.entries(drifted.byKind)) {
  console.log(
    `  ${kind.padEnd(7)} decide ${f(x.decided)}, puntúa ${f(x.scored)}, baja de nivel en ${pct(x.dropped)}`,
  );
}

const printChecks = (checks: readonly Check[]): void => {
  for (const check of checks) {
    const mark = check.pass ? "✓" : check.required ? "✗" : "·";
    const note = check.required ? "" : " [limitación conocida, no bloquea]";
    console.log(`  ${mark} ${check.name}: ${check.value} (meta ${check.target})${note}`);
  }
};
console.log("\n## Metas (perfil base)");
const checks = checkTargets(own, reliable, params);
printChecks(checks);
const typical = own.typical;
console.log(
  `  P como % del puntaje mediano de un jugador: ${DIFFICULTIES.map((d) => `${d} ${f((100 * params.mistakePenalty) / typical[d].playerMedian, 0)} %`).join(", ")}. H: ${DIFFICULTIES.map((d) => `${d} ${f((100 * params.hintPenalty) / typical[d].playerMedian, 0)} %`).join(", ")}.`,
);

const robustness: Record<string, { own: Metrics; speed: Metrics; checks: Check[] }> = {};
if (byProfile("flat").length > 0) {
  const sampled = new Set(byProfile("flat").map((r) => r.game));
  const subsample = base.filter((r) => sampled.has(r.game));
  console.log("\n## Robustez frente a T(L) (misma submuestra)");
  for (const profile of ["base", "flat", "steep"] as const) {
    const records = profile === "base" ? subsample : byProfile(profile);
    const m = evaluate(records, ownScorer(params), params);
    const s = evaluate(records, speedScorer, params);
    robustness[profile] = {
      own: m,
      speed: s,
      checks: checkTargets(m, reliability(records), params),
    };
    console.log(
      `  ${profile.padEnd(5)} propio: Spearman agrupado ${f(m.correlation.pooled)}, veloz gana ${pct(m.duels.fastWinRate)} (aporte ${pct(m.duels.fastAporteRate)}) · velocidad: Spearman agrupado ${f(s.correlation.pooled)}, veloz gana ${pct(s.duels.fastWinRate)}`,
    );
    printChecks(robustness[profile].checks);
  }
}

mkdirSync(values.out, { recursive: true });
const file = join(values.out, `report-${params.version}-seed${String(baseSeed)}.json`);
writeFileSync(
  file,
  JSON.stringify(
    {
      games,
      baseSeed,
      params,
      time: { wallMs: run.wallMs, cpuMs: run.cpuMs, analyses: run.analyses, simulations },
      own,
      speed,
      checks,
      defeats: lost,
      reliability: reliable,
      drift: drifted,
      robustness,
    },
    null,
    2,
  ),
);
console.log(`\nInforme: ${file}`);
