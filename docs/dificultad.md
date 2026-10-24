# Dificultad y banco de puzzles (F5)

Cómo se pasa de la calificación de un puzzle (`grade`, `docs/motor.md`) a la dificultad del juego, cómo se generó el banco y sus distribuciones. Las reglas verificables son T-20.3 a T-20.5 (SPEC 1.3). La decisión de versionar un manifiesto de semillas está en el ADR 0006.

## 1. Equivalencia, versión 1

`DIFFICULTY_MAPPING_VERSION = "1"` (`apps/server/src/puzzles/difficulty.ts`), aprobada el 2026-10-23.

| Dificultad | Criterio (con `TECHNIQUES` y `GRADER_VERSION` "2") |
|---|---|
| Fácil | Nivel máximo 2 o menos. |
| Media | Nivel máximo 3 con un solo paso de nivel 3. |
| Difícil | Nivel máximo 3 con 2 o más pasos de nivel 3, o nivel máximo 4. |
| Experto | Nivel máximo 5, con `unitCombination` acotada a 4 jaulas abiertas y 8 combinaciones. |
| Excluido | Excede las técnicas: no entra al banco (decisión a de F5). |

- **Es una versión inicial.** Se recalibra con la prueba manual de la muestra impresa (sección 6) y con partidas reales en la beta (F13). Si cambia, sube `DIFFICULTY_MAPPING_VERSION` y hay que generar un manifiesto nuevo.
- **Por qué se separan media y difícil por pasos de nivel 3:**
  - El nivel 3 tiene el 67 % del corpus, y la regla del 45 (innies y outies) es la habilidad central del killer. Necesitarla varias veces exige encontrar más regiones.
  - Los pasos de nivel 3 separan con claridad: de los 668 puzzles de nivel 3, 479 usan uno solo. Los de nivel 4 usan una mediana de 4 y los de nivel 5, de 6 o más.
  - Las deducciones de nivel 3 no separan: un solo paso aplica todas las regiones a la vez, y las de media y difícil se superponen (sección 3).
  - Sin esta separación, difícil sería solo el nivel 4 (7,7 % del corpus) y media quedaría con dos tercios del corpus, muy heterogénea.
- **El fácil no usa técnicas de nivel 4 o más:** `buildBank` lo comprueba con los pasos por nivel y falla si encuentra alguno (T-20.3).
- **`easyGivens`** (números iniciales del fácil, decisión b de F5) sigue sin usarse. Solo se activa si la prueba manual muestra que el fácil resulta difícil.

## 2. Cota de `unitCombination`

Sin cota, el nivel 5 dependía entero de una enumeración que llegaba a 825 combinaciones por deducción. Con la cota 4/8, la técnica solo mira unidades que una persona puede cruzar con notas. Detalle y mediciones en `docs/motor.md`, «Cota de `unitCombination` (F5)».

| Cota | Nivel 5 conservados (de 85) | Pasan a exceder | Tasa de nivel 5 | Minutos para 500 |
|---|---|---|---|---|
| Sin cota | 85 | 0 | 8,5 % | 4,7 |
| **4/8 (elegida)** | **39** | **46** | **3,9 %** | **9,9** |
| 5/16 | 75 | 10 | 7,5 % | 5,2 |
| 5/32 | 77 | 8 | 7,7 % | 5,1 |

Se eligió la cota más estrecha con la que 500 puzzles de nivel 5 salen en 30 minutos o menos en un hilo.

## 3. Distribución en el corpus (semillas 1 a 1000, cota 4/8)

Fuente: `packages/engine/test/grader-bounds.corpus.test.ts`.

| Nivel máximo | Puzzles | Pasos (mediana / p95 / máx.) | Pasos de nivel 3 (puzzles) | Deducciones de nivel 3 (mediana / p95 / máx.) |
|---|---|---|---|---|
| 2 | 100 | 52 / 66 / 71 | 0: 100 | 0 / 0 / 0 |
| 3 | 668 | 49 / 64 / 75 | 1: 479 · 2: 142 · 3: 37 · 4: 8 · 5: 1 · 6+: 1 | 65 / 101 / 135 |
| 4 | 77 | 62 / 75 / 91 | 1: 2 · 2: 3 · 3: 17 · 4: 19 · 5: 18 · 6+: 18 | 72 / 111 / 136 |
| 5 | 39 | 71 / 87 / 90 | 1: 1 · 2: 1 · 3: 4 · 4: 4 · 5: 8 · 6+: 21 | 74 / 102 / 111 |
| Exceden | 116 | 16 / 41 / 65 (hasta detenerse) | — | — |

Con la equivalencia, el corpus queda así:

| Dificultad | Puzzles | Pasos (mediana / p95 / máx.) | Deducciones de nivel 3 (mediana / p95 / máx.) |
|---|---|---|---|
| Fácil | 100 (10,0 %) | 52 / 66 / 71 | 0 / 0 / 0 |
| Media | 479 (47,9 %) | 47 / 62 / 70 | 62 / 101 / 135 |
| Difícil | 266 (26,6 %) | 56 / 72 / 91 | 75 / 110 / 136 |
| Experto | 39 (3,9 %) | 71 / 87 / 90 | 74 / 102 / 111 |
| Excluido | 116 (11,6 %) | — | — |

## 4. El banco de la v1

Generado el 2026-10-23 con `pnpm --filter @sudoku-killer/server bank:generate` (opciones por defecto: desde la semilla 1, 500 por dificultad). Manifiesto: `apps/server/bank/manifest.json`, con 2000 entradas y unos 200 KB. Generador "1", calificador "2" y equivalencia "1".

**Lote:**
- **15 254 semillas** evaluadas (1 a 15 254), en **9,2 minutos** con un hilo: **36,2 ms por candidato** entre generar, calificar y calcular el hash. El generador empezó 15 261 candidatos internos (7 descartados por el presupuesto de nodos).
- **1589 excluidos (10,4 %)** porque exceden las técnicas.
- Nivel máximo de todas las semillas evaluadas: 1616 de nivel 2, 10 187 de nivel 3, 1362 de nivel 4, 500 de nivel 5 y 1589 que exceden. El lote se detuvo al completar el experto, así que hay exactamente 500 de nivel 5.

**Candidatos por dificultad:**

| Dificultad | Semillas hasta completar 500 | Califican en todo el lote | En el banco |
|---|---|---|---|
| Fácil | 4661 | 1616 (10,6 %) | 500 |
| Media | 1048 | 7205 (47,2 %) | 500 |
| Difícil | 1793 | 4344 (28,5 %) | 500 |
| Experto | 15 254 | 500 (3,3 %) | 500 |

El experto limita el lote: sale en el 3,3 % de las semillas (3,9 % en las 1000 primeras).

**Distribución del banco:**

| Dificultad | Nivel máximo | Pasos (mediana / p95 / máx.) | Pasos de nivel 3 (puzzles) | Pasos por nivel, 1 a 5 (total) | Con números iniciales de unicidad |
|---|---|---|---|---|---|
| Fácil | 2: 500 | 51 / 66 / 77 | 0: 500 | 20 611 / 4946 / 0 / 0 / 0 | 27 |
| Media | 3: 500 | 47 / 62 / 75 | 1: 500 | 18 680 / 4505 / 500 / 0 / 0 | 0 |
| Difícil | 3: 354 · 4: 146 | 57 / 75 / 91 | 1: 3 · 2: 268 · 3: 98 · 4: 55 · 5: 36 · 6+: 40 | 19 618 / 7387 / 1516 / 282 / 0 | 0 |
| Experto | 5: 500 | 71 / 91 / 116 | 0: 1 · 1: 4 · 2: 19 · 3: 47 · 4: 71 · 5: 69 · 6+: 289 | 20 177 / 10 239 / 3107 / 1840 / 606 | 0 |

- Ningún fácil usa niveles 3, 4 o 5.
- Los 3 difíciles con un solo paso de nivel 3 son de nivel 4.
- Los números iniciales de unicidad (`givensReason: "uniqueness"`) aparecen solo en 27 fáciles. El generador los agrega cuando no encuentra cómo reajustar las jaulas; que todos caigan en fácil se explica, probablemente, porque un número inicial ya facilita el puzzle.

## 5. Cómo se regenera y se carga

- **Regenerar el manifiesto:** `pnpm --filter @sudoku-killer/server bank:generate [--base-seed 1] [--per-difficulty 500]`. Con las mismas opciones y versiones da el mismo archivo (T-20.4); imprime las tablas de la sección 4.
- **Cuándo hace falta:** si cambia `GENERATOR_VERSION`, `GRADER_VERSION`, `DIFFICULTY_MAPPING_VERSION` o `UNIT_COMBINATION_BOUND`. El cargador rechaza el manifiesto viejo.
- **Cargar en la base de datos:** `loadBank(db, manifest)` regenera y verifica cada semilla y después inserta en una transacción, de forma idempotente (ADR 0006). El comando contra PostgreSQL y la comprobación al arrancar se conectan en F9.
- **Pruebas:**
  - CI: una muestra del manifiesto en `apps/server/test/bank.test.ts` y `repository.test.ts`, con PGlite.
  - `pnpm test:corpus`: el banco completo en `apps/server/test/bank.corpus.test.ts`, que lo carga, lo verifica y juega una partida simulada por puzzle (T-20.5). En la primera corrida (2026-10-23), los 2000 puzzles se cargaron y verificaron en 95 s, y las 161 947 llamadas a `levelToDeduce` de las 2000 partidas dieron siempre un nivel entre 1 y el del puzzle, nunca `UNRATED`.

## 6. Prueba manual

No hay cliente hasta F8, así que la prueba manual se hace en papel.

- **Muestra:** `design/muestra-f5/muestra.html`, generada con `pnpm --filter @sudoku-killer/server bank:sample` (semilla 2026).
  - Son 12 puzzles, 3 por dificultad, en un orden al azar y con letras, para que quien los resuelve no sepa la dificultad.
  - Se imprimen 2 por hoja A4. Al final están la clave y las soluciones.
- **Qué se anota:** por puzzle, el tiempo, si se terminó y la dificultad percibida, de 1 a 5.
- **Qué se hace con el resultado:**
  - si el fácil resulta difícil, se activa `easyGivens` (decisión b);
  - si media y difícil no se distinguen, se revisa la equivalencia.
  - En ambos casos se genera un manifiesto nuevo antes de F9.
- **Desviación registrada:** la prueba con varios jugadores en tiempo real queda para F8 (con el servidor simulado) y para la beta de F13.

| Puzzle | Persona | Tiempo | ¿Terminado? | Dificultad percibida (1 a 5) | Comentarios |
|---|---|---|---|---|---|
| (pendiente) | | | | | |
