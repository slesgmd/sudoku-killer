# Dificultad y banco de puzzles (F5)

Cómo se arma cada dificultad del juego a partir de la calificación de un puzzle (`grade`, `docs/motor.md`), cómo se generó el banco y sus distribuciones. Las reglas verificables son T-20.2 a T-20.5 (SPEC 1.4). La decisión de versionar un manifiesto de semillas está en el ADR 0006.

## 1. Equivalencia vigente, versión 2

`DIFFICULTY_MAPPING_VERSION = "2"` (`apps/server/src/puzzles/difficulty.ts`), aprobada el 2026-10-23 tras la prueba en papel (sección 2). Reemplaza a la versión 1 (sección 7) y a la decisión b) de F5, que solo permitía números iniciales en el fácil.

| Dificultad | Números iniciales | Banda: nivel calculado con los números iniciales | Piso de la guarda |
|---|---|---|---|
| Fácil | 30 | nivel máximo 1 | — |
| Media | 22 | nivel máximo 2 (con algún paso de nivel 2) | algún paso de nivel 2 |
| Difícil | 10 | nivel máximo 3 o 4, con algún paso de nivel 3 | algún paso de nivel 3 |
| Experto | 0, salvo los de unicidad | nivel máximo 5, con `unitCombination` acotada a 4/8 | — |

**Las bandas no se solapan:** cada dificultad sube un nivel de técnica. Los puzzles que exceden las técnicas no entran al banco. Las cantidades incluyen los números de unicidad que el generador haya necesitado. En el experto del banco actual no hay ninguno.

**Cómo se eligen las celdas** (`addGivens`, `docs/motor.md`):
- **Orden:** las celdas se recorren dando vueltas por las cajas, en un orden de cajas al azar y con una celda al azar de cada caja por vuelta, así que los números quedan repartidos. El orden sale de la semilla del puzzle.
- **Guarda:** cada número se agrega solo si el puzzle, calificado con él, sigue cumpliendo el piso de su dificultad. Si se recorren todas las celdas sin llegar a la cantidad, el candidato se descarta.
- **Unicidad:** con los números agregados, A y B confirman de nuevo que la solución es única.
- **Por qué con guarda:** sin ella, los números bajan el nivel demasiado rápido (sección 3). Con 10 números al azar, el 99 % de los puzzles queda en nivel 2, y con 22, el 69 % se resuelve solo con singles.

**Una semilla, una dificultad:** la dificultad de una semilla es su resto al dividirla por 4 (0 fácil, 1 media, 2 difícil, 3 experto). Los números iniciales se agregan a un puzzle ya generado, así que sin esta regla un fácil y una media podrían compartir cuadrícula y jaulas.

**Consecuencia de la guarda** (sección 4): la guarda agrega números mientras el piso se mantenga, así que deja el mínimo de técnica que la banda exige. En el banco actual, todas las medias necesitan un solo paso de nivel 2 (combinación de jaula), salvo una que necesita dos. Todas las difíciles necesitan un solo paso de nivel 3 (regla del 45). La segunda prueba en papel (2026-10-24, sección 6) mostró que alcanza para distinguirlas.

## 2. Prueba en papel y decisión

- **Muestra:** 12 puzzles de la equivalencia versión 1, generada el 2026-10-23 con la semilla 2026. Esos puzzles no tenían números iniciales, salvo los de unicidad.
- **Conclusión:** sin números iniciales, los puzzles resultan difíciles, incluido el fácil.
- **Decisión** (aprobada por el usuario el 2026-10-23):
  - números iniciales escalonados por dificultad (30, 22, 10 y 0), con las bandas de la sección 1;
  - celdas con guarda, repartidas por cajas y con semilla;
  - semillas separadas por dificultad;
  - `GENERATOR_VERSION` "2";
  - A también confirma la unicidad.

## 3. Medición de los números iniciales

Medición previa a la decisión. Se usaron las semillas 1 a 1000 para las celdas al azar y por cajas, y 1 a 300 para las celdas con guarda (que califican el puzzle tras cada número). En cada semilla, el puzzle base recibe números hasta tener N en total y se califica con ellos; la tasa es la proporción de candidatos que cae en la banda.

Las bandas de esta medición eran las de la propuesta: fácil, nivel ≤ 2; media, nivel ≤ 3 con algún paso de nivel 2; difícil, nivel 3 o 4 con algún paso de nivel 3. Las aprobadas son más estrictas en fácil y media, y el banco de la sección 4 cumple esas con tasas del 99 % y del 100 %.

| Dificultad | N | Tasa: al azar · por cajas · con guarda | Pasos (mediana): al azar · por cajas · con guarda | Minutos para 500 con guarda | Niveles 1/2/3/4/5/exceden: al azar → con guarda |
|---|---|---|---|---|---|
| Fácil | 26 | 100 · 100 · 100 % | 16 · 14 · 14 | 0,7 | 906/94/0/0/0/0 → 290/10/0/0/0/0 |
| Fácil | **30** | 100 · 100 · 100 % | 14 · 14 · 14 | 0,7 | 979/21/0/0/0/0 → 296/4/0/0/0/0 |
| Fácil | 34 | 100 · 100 · 100 % | 13 · 12 · 12 | 0,8 | 988/12/0/0/0/0 → 300/0/0/0/0/0 |
| Media | 18 | 78 · 68 · 100 % | 16 · 14 · 13 | 0,7 | 217/783/0/0/0/0 → 0/300/0/0/0/0 |
| Media | **22** | 31 · 16 · 100 % | 17 · 15 · 14 | 0,7 | 687/313/0/0/0/0 → 0/300/0/0/0/0 |
| Media | 26 | 9 · 4 · 100 % | 17 · 16 · 12 | 0,8 | 906/94/0/0/0/0 → 0/300/0/0/0/0 |
| Difícil | 8 | 3,0 · 2,9 · 88 % | 34 · 36 · 29 | 1,3 | 0/970/30/0/0/0 → 0/34/265/0/0/1 |
| Difícil | **10** | 0,8 · 0,5 · 87 % | 39 · 29 · 25 | 1,5 | 0/991/8/0/1/0 → 0/34/265/1/0/0 |
| Difícil | 12 | 0 · 0 · 83 % | — · — · 23 | 1,8 | 0/1000/0/0/0/0 → 0/34/265/0/1/0 |

- Sin guarda, el difícil con 10 números costaba 31 minutos (al azar) o 50 (por cajas) para 500 puzzles, y con 12 no salía ninguno. Repartir los números por cajas, sin guarda, facilita los puzzles más que ponerlos al azar.
- La unicidad se comprobó con A en 920 puzzles con números iniciales: todos únicos.

## 4. El banco, versión 2

Generado el 2026-10-23 con `pnpm --filter @sudoku-killer/server bank:generate` (desde la semilla 1, 500 por dificultad). Manifiesto: `apps/server/bank/manifest.json`, con 2000 entradas y unos 200 KB. Generador "2", calificador "2" y equivalencia "2".

**Lote:** semillas 1 a 62 079, **17 090 candidatos** evaluados en **13,1 minutos** con un hilo. Cada semilla se evalúa solo para su dificultad y se salta cuando esa dificultad ya está completa.

| Dificultad | Candidatos | Aceptados | Tasa | ms por candidato | Nivel máximo de todos los candidatos |
|---|---|---|---|---|---|
| Fácil | 505 | 500 | 99,0 % | 85,3 | 1: 500 · 2: 5 |
| Media | 500 | 500 | 100 % | 85,1 | 2: 500 |
| Difícil | 565 | 500 | 88,5 % | 154,5 | 2: 59 · 3: 504 · 4: 2 |
| Experto | 15 520 | 500 | 3,2 % | 39,7 | 2: 1756 · 3: 10 374 · 4: 1349 · 5: 500 · exceden: 1541 |

- Las tasas quedan muy por encima del 50 % pedido como mínimo, salvo el experto, que no cambió.
- El tiempo total queda por debajo de los 30 minutos.
- El experto limita el lote, como en la versión 1.

**Distribución del banco:**

| Dificultad | Números iniciales | Nivel máximo | Pasos (mediana / p95 / máx.) | Pasos por nivel, 1 a 5 (total) | Pasos de nivel 3 (puzzles) |
|---|---|---|---|---|---|
| Fácil | 30 en los 500 | 1: 500 | 14 / 20 / 27 | 6843 / 0 / 0 / 0 / 0 | 0: 500 |
| Media | 22 en los 500 | 2: 500 | 13 / 23 / 33 | 6640 / 501 / 0 / 0 / 0 | 0: 500 |
| Difícil | 10 en los 500 | 3: 498 · 4: 2 | 25 / 39 / 49 | 9714 / 2739 / 500 / 2 / 0 | 1: 500 |
| Experto | 0 en los 500 | 5: 500 | 71 / 92 / 116 | 20 311 / 10 124 / 2996 / 1862 / 614 | 1: 5 · 2: 21 · 3: 54 · 4: 76 · 5: 87 · 6+: 257 |

- Todos los números iniciales de fácil, media y difícil tienen `givensReason: "difficulty"`. Ningún experto necesitó números de unicidad.
- Fácil y media tienen casi los mismos pasos. Se distinguen por la técnica: el fácil se resuelve solo con singles, y la media necesita una combinación de jaula.

## 5. Cómo se regenera y se carga

- **Regenerar el manifiesto:** `pnpm --filter @sudoku-killer/server bank:generate [--base-seed 1] [--per-difficulty 500]`. Con las mismas opciones y versiones da el mismo archivo (T-20.4) e imprime las tablas de la sección 4.
- **Cuándo hace falta:** si cambian `GENERATOR_VERSION`, `GRADER_VERSION`, `DIFFICULTY_MAPPING_VERSION`, `UNIT_COMBINATION_BOUND` o los números iniciales de una dificultad. El cargador rechaza el manifiesto viejo.
- **Cargar en la base de datos:** `loadBank(db, manifest)` regenera y verifica cada semilla con sus números iniciales y después inserta en una transacción, de forma idempotente (ADR 0006). El comando contra PostgreSQL y la comprobación al arrancar se conectan en F9.
- **Pruebas:**
  - CI: una muestra del manifiesto en `apps/server/test/bank.test.ts` y `repository.test.ts`, con PGlite.
  - `pnpm test:corpus`: el banco completo en `apps/server/test/bank.corpus.test.ts`, que lo carga, lo verifica y juega una partida simulada por puzzle (T-20.5). Con la versión 2 (2026-10-23), los 2000 puzzles se cargaron y verificaron en 421 s, en paralelo con los otros corpus. Las 131 000 llamadas a `levelToDeduce` de las 2000 partidas dieron siempre un nivel entre 1 y el del puzzle, nunca `UNRATED`.
- **Parte pura en `packages/bank` (F8):** la equivalencia (`difficulty.ts`), el esquema del manifiesto y `regenerateSeed` pasaron del servidor a un paquete puro, para que el servidor simulado del cliente regenere las mismas semillas sin copiar las reglas. El hash con `node:crypto` y la carga siguen en `apps/server`.

### 5.1 Carga en el servidor simulado del cliente (F8)

En desarrollo, el servidor simulado (`apps/web/src/dev/sim/`) toma una semilla al azar de la dificultad pedida en el manifiesto, la regenera en el navegador con `regenerateSeed` y comprueba la dificultad, la calificación y el hash (`crypto.subtle`, idéntico al de `node:crypto`, con una prueba sobre una muestra) contra su entrada. El manifiesto se importa con el alias `@dev/bank-manifest`, que solo existe al servir en desarrollo y en las pruebas: un build no lo resuelve, y `check-dist` confirma que no queda en el de producción (T-31.2).

Tiempo de carga (regenerar y calcular el hash), medido en Node con las primeras 50 semillas de cada dificultad (`pnpm --filter @sudoku-killer/web sim:measure`, 2026-10-24):

| Dificultad | Mediana | p95 | Máximo |
|---|---|---|---|
| Fácil | 110 ms | 161 ms | 277 ms |
| Media | 110 ms | 156 ms | 213 ms |
| Difícil | 157 ms | 264 ms | 275 ms |
| Experto | 54 ms | 87 ms | 101 ms |

El experto es el más rápido porque no lleva números iniciales: `addGivens` califica el puzzle con cada número que agrega. En el navegador, el simulador escribe el tiempo de cada carga en la consola (`[sim] … loaded in N ms`). Los tiempos en PC y en celular se anotan en el punto de control de F8; si en el celular pasan de unos 1,5 s, se propone mover la carga a un Worker.

## 6. Prueba manual

- **Muestra nueva:** `design/muestra-f5/muestra.html`, generada con `pnpm --filter @sudoku-killer/server bank:sample` (semilla 2026), desde el manifiesto de la versión 2.
  - Son 12 puzzles, 3 por dificultad, en un orden al azar y con letras.
  - La cantidad de números iniciales anticipa la dificultad. Al final están la clave y las soluciones.
- **Qué se anota:** por puzzle, el tiempo, si se terminó y la dificultad percibida, de 1 a 5.
- **Qué se hace con el resultado:** si las dificultades no se distinguen o no siguen el orden esperado, se ajustan las cantidades o las bandas, con una nueva versión de la equivalencia y un manifiesto nuevo, antes de F9.
- **Desviación registrada:** la prueba con varios jugadores en tiempo real queda para F8 (con el servidor simulado) y para la beta de F13.

| Puzzle | Persona | Tiempo | ¿Terminado? | Dificultad percibida (1 a 5) | Comentarios |
|---|---|---|---|---|---|
| Un medio y un difícil de la muestra versión 2 | Usuario | No anotado | Sí, los dos | No anotada en números | La diferencia entre el medio y el difícil se nota, y el fácil se siente fácil. |

**Resultado de la segunda prueba (2026-10-24):** las dificultades se distinguen en el orden esperado. Una sola persona resolvió dos puzzles, así que es una señal y no una medición; la calibración sigue con partidas reales en F13.
- La equivalencia versión 2 se mantiene, incluida la guarda que deja un solo paso de nivel 2 en las medias y uno de nivel 3 en las difíciles (sección 1).
- No se regenera el manifiesto ni se vuelve a cargar el banco.

## 7. Historia: versión 1 (sin números iniciales por dificultad)

Equivalencia aprobada el 2026-10-23 y reemplazada el mismo día por la versión 2.
- **Bandas:** fácil, nivel máximo ≤ 2; media, nivel 3 con un paso de nivel 3; difícil, nivel 3 con 2 o más pasos de nivel 3, o nivel 4; experto, nivel 5.
- **Números iniciales:** solo los de unicidad.
- **Banco v1:** 15 254 semillas en 9,2 minutos y 1589 excluidas (10,4 %).

**Cota de `unitCombination`**, que sigue vigente. Sin cota, el nivel 5 dependía de una enumeración que llegaba a 825 combinaciones por deducción. Con la cota 4/8, la técnica solo mira unidades que una persona puede cruzar con notas (`docs/motor.md`, «Cota de `unitCombination` (F5)»).

| Cota | Nivel 5 conservados (de 85) | Pasan a exceder | Tasa de nivel 5 | Minutos para 500 |
|---|---|---|---|---|
| Sin cota | 85 | 0 | 8,5 % | 4,7 |
| **4/8 (elegida)** | **39** | **46** | **3,9 %** | **9,9** |
| 5/16 | 75 | 10 | 7,5 % | 5,2 |
| 5/32 | 77 | 8 | 7,7 % | 5,1 |

**Corpus sin números iniciales** (semillas 1 a 1000, cota 4/8, `packages/engine/test/grader-bounds.corpus.test.ts`):

| Nivel máximo | Puzzles | Pasos (mediana / p95 / máx.) | Pasos de nivel 3 (puzzles) | Deducciones de nivel 3 (mediana / p95 / máx.) |
|---|---|---|---|---|
| 2 | 100 | 52 / 66 / 71 | 0: 100 | 0 / 0 / 0 |
| 3 | 668 | 49 / 64 / 75 | 1: 479 · 2: 142 · 3: 37 · 4: 8 · 5: 1 · 6+: 1 | 65 / 101 / 135 |
| 4 | 77 | 62 / 75 / 91 | 1: 2 · 2: 3 · 3: 17 · 4: 19 · 5: 18 · 6+: 18 | 72 / 111 / 136 |
| 5 | 39 | 71 / 87 / 90 | 1: 1 · 2: 1 · 3: 4 · 4: 4 · 5: 8 · 6+: 21 | 74 / 102 / 111 |
| Exceden | 116 | 16 / 41 / 65 (hasta detenerse) | — | — |
