# 0006 — Banco de puzzles como manifiesto de semillas

- Estado: aceptada
- Fecha: 2026-10-23

## Contexto
F5 genera el banco de la v1: 500 puzzles por dificultad, con su solución, que van a la tabla `puzzles` (ADR 0003). Hay que decidir qué se versiona en el repositorio y cómo llega el banco a la base de datos.

El generador es determinista (T-35.6): con la misma semilla, las mismas opciones y la misma `GENERATOR_VERSION`, da siempre el mismo puzzle. El calificador también es determinista, con su `GRADER_VERSION`.

## Decisión

**Se versiona un manifiesto, no los puzzles.**
- Vive en `apps/server/bank/manifest.json` y lo escribe `pnpm --filter @sudoku-killer/server bank:generate`.
- La cabecera guarda las versiones del generador, del calificador y de la equivalencia de dificultades (`docs/dificultad.md`), la cota de `unitCombination`, los números iniciales de cada dificultad, la primera semilla y la cantidad por dificultad.
- Cada entrada tiene `seed`, `difficulty`, `graderMaxLevel`, `graderSteps` y `hash`: los primeros 16 dígitos hexadecimales del SHA-256 del puzzle y su solución, en un orden de campos fijo.
- Cada semilla pertenece a una sola dificultad, por su resto al dividirla por 4 (desde la equivalencia versión 2). Así, dos puzzles del banco nunca comparten cuadrícula y jaulas, porque los números iniciales se agregan a un puzzle ya generado.
- Las entradas son, para cada dificultad, sus primeras 500 semillas cuyo puzzle, con los números iniciales de esa dificultad, cumple su banda. Con las mismas opciones, el script da el mismo manifiesto.
- Ocupa unos 200 KB, con una entrada por línea para que los cambios se lean en un diff. El banco completo pesaría unos 2–3 MB.

**Carga** (`loadBank`, en `apps/server/src/puzzles/load-bank.ts`):
1. Comprueba que las versiones del manifiesto coincidan con las del motor y la equivalencia vigentes. Si no, falla y pide un manifiesto nuevo.
2. Regenera cada semilla con sus números iniciales y comprueba el hash, el nivel, los pasos, la dificultad y la banda. Si algo no coincide, falla con la semilla **antes de escribir nada**.
3. Inserta en una transacción con `ON CONFLICT (generator_version, seed) DO NOTHING`, así que cargar dos veces no duplica filas.

Con el banco completo tarda unos minutos (generar y calificar unas 2000 semillas). Por eso es un paso de despliegue, no del arranque del servidor. El comando contra PostgreSQL (`bank:load` con `DATABASE_URL`) y la comprobación al arrancar de que hay puzzles de cada dificultad se conectan en F9.

**`id` opaco.**
- El `id` de cada puzzle es un UUID aleatorio de la base de datos y no deriva de la semilla. La semilla queda en la columna `seed`, que nunca sale del servidor.
- El motivo es que un cliente no pueda enumerar el banco ni predecir el puzzle siguiente.
- **No** protege la solución. Cualquier solver la obtiene del puzzle público, porque es única, y el solver del motor está en el repositorio público. Lo que protege la solución es que el servidor nunca la envía (R-31, T-31.3).

## Alternativas consideradas
- **Versionar el banco completo (JSON o SQL):**
  - no depende de que el generador siga igual, y la carga no regenera nada;
  - pero pesa más de 10 veces lo que el manifiesto y no se puede revisar en un diff;
  - además, mete en el repositorio miles de soluciones que el manifiesto ya permite reproducir.
- **Generar el banco al arrancar el servidor:** cada arranque tardaría minutos, y un cambio del motor cambiaría el banco sin aviso.
- **Usar la semilla como `id`:** es simple, pero permite enumerar el banco y predecir el puzzle siguiente.

## Consecuencias
- El manifiesto depende de que el generador y el calificador no cambien.
  - Un cambio que altere los puzzles o su calificación sube la versión que corresponde, y el cargador rechaza el manifiesto viejo.
  - Entonces se genera un manifiesto nuevo. Las filas ya cargadas siguen en la base de datos, con su `generator_version` y su `grader_version`, y las partidas viejas siguen apuntando a ellas.
- El índice único `(generator_version, seed)` permite que convivan bancos de distintas versiones del generador.
- `pnpm test:corpus` regenera y verifica el banco completo (`bank.corpus.test.ts`). La CI verifica una muestra.
