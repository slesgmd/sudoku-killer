# Motor del puzzle (`packages/engine`)

Documento vivo de F4: API, algoritmos y mediciones del motor. Las reglas y sus pruebas están en SPEC R-35 (T-35.1 a T-35.6); el plan por subfases, en `PLAN.md` (F4a–F4f).

## Principios
- Lógica pura: sin E/S, reloj ni azar. `Date.now()` y `Math.random()` están prohibidos por lint en todo el paquete; el generador recibe una semilla.
- Tamaño parametrizado: `Geometry { size, boxRows, boxCols }` con `size = boxRows × boxCols` y `size ≤ 16`, para que una máscara de candidatos entre en 16 bits. La v1 usa 9×9; las pruebas usan también 4×4 (2×2) y 6×6 (2×3).
- Celdas por filas: `cell = row × size + col`. Máscaras: el bit `d − 1` es el dígito `d`.
- Los dos solvers son independientes: B (`src/solver-b/`) solo puede importar `src/types.ts`, y A (`src/solver-a/`) no puede importar B. Lo comprueba una regla de lint con su test (`tests/lint-solver-isolation.test.ts`).

### Aserción de no nulo (`!`)
La regla `@typescript-eslint/no-non-null-assertion` rige en todo el monorepo, incluidos el modelo, los validadores, la geometría y los tests del motor. Ahí se usan `for...of`, `forEach` con índice, comprobaciones explícitas o `at(list, index)` (`src/model/at.ts`), que lanza un `RangeError` si el índice no existe: un error de índice falla en el acto en vez de propagar `undefined` a la validación o a las notas.

La única excepción es un override de ESLint limitado a `packages/engine/src/solver-a/**` y `packages/engine/src/solver-b/**` (`SOLVER_FILES` en `eslint.config.js`). Motivo:
- Los solvers recorren máscaras de candidatos en `Uint16Array` millones de veces por puzzle (el generador llama al solver en cada intento, y el plan de F4 exige 1000 puzzles verificados por A y B). Con `noUncheckedIndexedAccess`, cada lectura es `number | undefined`; una comprobación o una llamada a `at` en esos bucles añade una rama y una llamada por acceso, sin aportar seguridad.
- Allí los índices están garantizados por construcción: celdas en `0..size² − 1` de un puzzle ya validado con `validateStructure`, y unidades y jaulas tomadas del `Layout` precalculado. Un índice fuera de rango es un error del solver, y lo detectan los tests (la solución pasa `validateSolution`, y A y B se comparan entre sí y con la fuerza bruta).
- Fuera de esos bucles, los solvers también prefieren `for...of`. El alcance del override lo fija `tests/lint-non-null.test.ts`.

### Pruebas aleatorias y semillas
Las pruebas de propiedades usan `assertProperty` (`test/helpers/property.ts`) en vez de `fc.assert`, que está prohibido por lint en todas las pruebas del monorepo (`tests/lint-property-seed.test.ts`).
- **Todo fallo imprime la semilla.** Si falla la propiedad, el mensaje de fast-check trae `{ seed, path }` y el contraejemplo reducido. `assertProperty` devuelve además la semilla de la ejecución, para que las comprobaciones posteriores sobre el conjunto de ejecuciones (por ejemplo, «hubo al menos un conjunto de pocas soluciones») la impriman con `expect(x, seedMessage(seed))`.
- **Cada semilla que falle se agrega como caso fijo de regresión**, en la lista `regressions` de esa misma propiedad: `assertProperty(property, { numRuns, regressions: [{ seed, path }] })`. Las regresiones se ejecutan siempre, antes que la semilla nueva de cada ejecución. Se agrega aunque el fallo ya esté corregido, con un comentario que diga qué falló. Si falló una comprobación posterior (sin `path`), basta la semilla.
- Una semilla reproduce sus valores mientras no cambien los arbitrarios de la propiedad. Si un cambio los altera, el contraejemplo se copia además como caso fijo explícito (un puzzle literal en un `it` propio), que no depende de fast-check.

## Modelo (F4a)

| Módulo | Contenido |
|---|---|
| `src/types.ts` | `Geometry`, `Cage`, `Given`, `KillerPuzzle`, `Grid`. Solo tipos: es lo único que comparten A y B. |
| `src/model/geometry.ts` | `isValidGeometry`, `cellIndex`, `layoutOf` (filas, columnas, cajas y pares, memoizado por geometría), `cageIndexByCell`, `peersWithCage`. |
| `src/model/at.ts` | `at(list, index)`: acceso con `RangeError` si el índice no existe (ver "Aserción de no nulo"). |
| `src/model/mask.ts` | `digitBit`, `fullMask`, `hasDigit`, `popcount`, `digitsOf`, `singleDigit`. |
| `src/model/structure.ts` | `validateStructure`: geometría; jaulas de 2 a 5 celdas (y como mucho `size`), ids únicos, celdas en rango, disjuntas, conectadas, que cubren el tablero y con suma alcanzable; números iniciales en rango, sin celdas repetidas y sin conflictos con sus pares. `cageSumRange(k, size)`. |
| `src/model/validate.ts` | `validateSolution` (filas, columnas, cajas, jaulas sin repetir, sumas y números iniciales), `checkPlacement` (`correct` / `mistake`) e `isEvidentMistake` (R-28: repite un dígito bloqueado de su fila, columna, caja o jaula). |
| `src/model/notes.ts` | `cleanupPeers` (R-17, ADR 0005): devuelve notas nuevas sin tocar las de entrada, y la lista ordenada de candidatos quitados para el deshacer con comprobación (P7). `clearCellNotes` vacía solo la celda (notas personales con la limpieza desactivada). |

Las funciones de validación devuelven listas de problemas con un código (vacías si todo está bien), en vez de un booleano, para que el generador y los tests sepan qué falló.

### Ayudas de prueba
- `test/helpers/grids.ts`: cuadrículas válidas a partir de un patrón (la fila `r` se desplaza `(r mod boxRows) · boxCols + ⌊r / boxRows⌋`) y transformaciones que conservan la validez (reetiquetar dígitos, permutar bandas, filas dentro de una banda, pilas y columnas, y transponer si las cajas son cuadradas). No hay cuadrículas recordadas: el validador comprueba el patrón en cada geometría.
- `partitionCages` y `killerArb`: particiones aleatorias en jaulas válidas sobre esas cuadrículas, para las pruebas de propiedades.
- `test/helpers/puzzles.ts` (F4c): puzzles derivados para las pruebas de los solvers. Variantes con sumas desplazadas o números iniciales erróneos, puzzles con números iniciales de su cuadrícula y la cadena de números iniciales hasta la unicidad.

## Solver A (F4b)

`solveA(puzzle, { limit = 2, maxNodes = Infinity })` → `{ count, solutions, nodes, exhausted }`.
- `count`: 0 (sin solución), 1 (una) o 2 (dos o más). Con `limit = 1`, 1 significa «al menos una».
- `solutions`: las encontradas, como mucho `limit`, en el orden de la búsqueda. `limit` es un entero ≥ 1 o `Infinity` (las pruebas lo usan para enumerarlas todas).
- `nodes`: estados propagados, incluida la raíz. Nunca pasa de `maxNodes`.
- `maxNodes` (F4d): presupuesto de nodos, entero ≥ 1 o `Infinity`. Si la búsqueda lo agota, se detiene con `exhausted: true`, y `count` y `solutions` son solo lo encontrado hasta ahí (un prefijo de lo que encuentra la búsqueda completa). Es de nodos y no de tiempo porque el motor no lee el reloj. Lo usa el generador.
- Exige una estructura válida (`validateStructure`); si no, lanza `RangeError`.
- Es determinista: no hay azar, los dígitos se prueban de menor a mayor y los empates se resuelven por índice.

### Módulos (`src/solver-a/`)

| Módulo | Contenido |
|---|---|
| `combos.ts` | `cageCombinations(size, k, suma)`: máscaras de `k` dígitos distintos de 1 a `size` con esa suma. Se construye una vez por tamaño recorriendo las `2^size` máscaras (65 536 en 16×16) con conteo y suma incrementales. |
| `context.ts` | Datos precalculados por puzzle: unidades, pares (fila, columna, caja y jaula), cruces caja-línea, grupos de suma (jaulas, innies y outies) y memoria de trabajo. |
| `propagate.ts` | Propagación hasta un punto fijo. |
| `solve.ts` | Búsqueda con backtracking y `solveA`. |

### Propagación
Los candidatos son un `Uint16Array` de máscaras. Un fallo (una celda sin candidatos) corta la rama. Las reglas, en orden, de las baratas y locales a las que recorren todo el tablero:
1. **Singles** con una cola: cuando una celda queda con un candidato, ese dígito sale de sus pares (fila, columna, caja y jaula).
2. **Grupos de suma** marcados como cambiados. Un grupo es un conjunto de celdas con suma conocida:
   - **Jaulas**, y **innies y outies** de pocas celdas que son pares entre sí: filtro exacto. Para cada combinación de la tabla que cubre las celdas, se busca, por cada par (celda, dígito) todavía sin soporte, una asignación completa sin repetir que lo use; cada asignación encontrada da soporte a todas sus celdas. Cada celda se queda solo con los dígitos con soporte. Es la consistencia exacta del grupo, así que incluye las **cotas de suma** y los hidden singles de la jaula.
   - **Dígitos obligatorios** de un grupo exacto (los que están en todas sus combinaciones posibles): si una sola celda los admite, van ahí; si las que los admiten comparten fila, columna o caja, salen del resto de esa unidad.
   - **Innies y outies grandes** o con celdas que pueden repetir dígito: cotas de suma (cada celda entre la suma menos el máximo y la suma menos el mínimo de las demás).
3. **Hidden singles** en filas, columnas y cajas. Si a una unidad le falta un dígito, o dos dígitos solo caben en la misma celda, es un fallo.
4. **Locked candidates**: un dígito que en una caja solo cabe en el cruce con una línea sale del resto de la línea, y al revés.

**Innies y outies (regla del 45).** Una región que es unión de `k` unidades completas suma `k · size · (size + 1) / 2`. Restando las jaulas que caben enteras, las celdas de la región que pertenecen a jaulas que sobresalen (innies) tienen suma conocida; también la tienen las celdas de esas jaulas que quedan fuera (outies). Regiones: cada caja, cada par de cajas vecinas, cada bloque de 2 × 2 cajas y cada unión de 1 a `size − 1` filas o columnas consecutivas. Los grupos se calculan una vez por puzzle.

### Búsqueda
Backtracking en profundidad. En cada nodo se propaga y, si quedan celdas sin resolver, se ramifica sobre los dígitos de una celda, de menor a mayor. La celda se elige con **dom/wdeg**: la que minimiza `candidatos / peso`. Todos los pesos empiezan en 1, así que la primera elección es MRV (la celda con menos candidatos). Cada fallo de la propagación suma 1 al peso de las celdas de la restricción que falló (el grupo, la unidad o el par de celdas), así que la búsqueda se concentra en la parte difícil del puzzle. Se detiene al llegar a `limit` soluciones.

### Pruebas (T-35.1, parte del solver A)
`test/solver-a.test.ts`, con el oráculo `test/helpers/brute-force.ts`, que enumera las 288 cuadrículas válidas de 4×4 con un backtracking ingenuo, sin usar el motor, y filtra con `validateSolution`.
- 4×4 aleatorios (`killerArb` con números iniciales de la cuadrícula, a veces una suma desplazada en ±1 o un número inicial erróneo): el conjunto de soluciones de `solveA` con `limit: Infinity` es exactamente el de la fuerza bruta, y `count` con el límite por defecto es `min(soluciones, 2)`.
- Casos fijos con 0 soluciones (una suma desplazada rompe el total del tablero), 1 (números iniciales agregados hasta la unicidad) y 2 o más (jaulas iguales a las cajas: un sudoku vacío, con las 288 soluciones; el límite corta en 1, 2 y 5).
- 6×6 y 9×9: agregar números iniciales de la cuadrícula donde difieren las dos primeras soluciones termina en un puzzle único cuya solución es esa cuadrícula; toda solución devuelta pasa `validateSolution`; el resultado es determinista.
- La tabla de combinaciones coincide con una enumeración independiente de subconjuntos en 4×4, 6×6, 9×9 y 16×16.

### Mediciones
1000 puzzles aleatorios por tamaño (`killerArb`, semilla 42, jaulas de 2 a 5 celdas, sin números iniciales). Node 24.21, AMD Ryzen 9 9955HX, un hilo. Tiempo por llamada a `solveA` con `limit = 2`.

| Tamaño | Únicos / 2 o más | Media | Mediana | p90 | p99 | Máximo | Nodos (mediana / p99 / máx.) |
|---|---|---|---|---|---|---|---|
| 4×4 | 69 / 931 | 0,19 ms | 0,16 ms | 0,3 ms | 0,6 ms | 4 ms | 5 / 9 / 9 |
| 6×6 | 26 / 974 | 0,46 ms | 0,45 ms | 0,6 ms | 0,9 ms | 2 ms | 7 / 16 / 23 |
| 9×9 | 94 / 906 | 7,0 ms | 1,7 ms | 6,7 ms | 49 ms | 2,4 s | 10 / 763 / 41 234 |

Cómo se llegó aquí (9×9, semilla 42):

| Versión | Muestra | Media | Máximo |
|---|---|---|---|
| Singles, hidden singles, filtro exacto de jaulas y MRV | 20 puzzles | 1,7 s | 27,8 s (924 000 nodos) |
| + innies y outies, locked candidates, dígitos obligatorios y cola de singles | 1000 puzzles | 81 ms | 57,7 s (1,17 M nodos) |
| + dom/wdeg y uniones de cajas (versión actual) | 1000 puzzles | 7,0 ms | 2,4 s (41 000 nodos) |

- La cola pesada venía del *thrashing*: puzzles con muchas soluciones y jaulas grandes en los que MRV se metía en subárboles enormes sin solución antes de encontrar la primera. dom/wdeg bajó el peor caso de 616 000 a unos 500 nodos.
- No se adoptaron: grupos exactos de más de 5 celdas (casi no reducen nodos y encarecen cada uno), desempates del MRV por tamaño de la jaula o por producto de candidatos (peores).
- Los puzzles generados en F4d tendrán solución única; su tiempo de verificación se mide allí.

## Solver B (F4c)

`solveB(puzzle, { limit = 2, prune = true })` → `{ count, solutions, nodes }`, con la misma semántica que `solveA`: `count` 0, 1 o 2; como mucho `limit` soluciones en el orden de la búsqueda; `limit` entero ≥ 1 o `Infinity`; determinista. `nodes` cuenta las coberturas parciales visitadas, incluida la vacía. No es comparable con los nodos de A.

Con `prune: false` se desactiva toda la poda propia de B: las reglas 1 a 3 y el descarte de opciones que repiten un número inicial de su fila, columna o caja. Queda Dancing Links puro (algoritmo X con MRV sobre la formulación de abajo), que sirve de referencia para la poda. Las cotas de suma con las que se enumeran las permutaciones de cada jaula se mantienen: no son poda, porque generan exactamente las permutaciones de dígitos distintos que dan la suma.

B solo importa `src/types.ts` (lint, T-35.1), así que no puede usar `validateStructure`. Comprueba lo que necesita para que la matriz esté bien definida: geometría, jaulas de 2 a 5 celdas que parten el tablero y números iniciales en rango sin celdas repetidas. Si algo falla, lanza `RangeError`. El resto de la estructura no lo repite: con una suma inalcanzable, la jaula no tiene opciones y B devuelve 0 soluciones, mientras que A lanza `RangeError`. Los llamadores validan la estructura antes, como hará el generador.

### Módulos (`src/solver-b/`)

| Módulo | Contenido |
|---|---|
| `matrix.ts` | Comprobación de la entrada y matriz de cobertura exacta. |
| `dlx.ts` | Dancing Links sobre `Int32Array`: `buildLinks`, `cover` y `uncover` (algoritmo X), y `hide` y `unhide` para quitar una opción suelta y devolverla. |
| `regions.ts` | Regiones con suma conocida y suma parcial de cada opción en cada región que corta su jaula. |
| `solve.ts` | Poda, búsqueda y `solveB`. |

### Formulación
Cobertura exacta con ítems primarios: cada celda y cada (fila, dígito), (columna, dígito) y (caja, dígito). Cada **opción** llena una jaula entera con una permutación de dígitos distintos que da su suma. Las permutaciones se generan en orden lexicográfico, con cotas de suma y respetando los números iniciales. También se descartan las que ponen en una celda un dígito que ya está como número inicial en su fila, columna o caja: es solo una poda, porque la cobertura exacta ya las excluiría. Una cobertura exacta es, por construcción, una solución del killer.

### Búsqueda
Algoritmo X con Dancing Links. Se ramifica sobre el ítem con menos opciones (MRV; ante un empate, el de menor índice) y las opciones se prueban en orden. Si un ítem tiene una sola opción, se toma sin podar. Antes de cada ramificación real se poda hasta un punto fijo con tres reglas propias:
1. **Un ítem de una sola jaula.** Si todas las opciones que cubren un ítem de dígito son de la misma jaula, se ocultan las demás opciones de esa jaula.
2. **Una jaula que fuerza un ítem.** Si todas las opciones de una jaula cubren un ítem de dígito (la jaula pone ese dígito en esa fila, columna o caja haga lo que haga), se ocultan las opciones de otras jaulas que lo cubren. Las reglas 1 y 2 son subsunción entre ítems de la cobertura exacta, con cada jaula como un ítem.
3. **Regla del 45 por cotas.** Hay una región por cada fila, columna o caja, por cada unión de filas o de columnas consecutivas y por el tablero entero. A su total se le restan las jaulas que caben enteras. Cada jaula que corta la región aporta una suma parcial que depende de su opción. Con el mínimo y el máximo de cada aporte entre las opciones activas, se ocultan las opciones con las que la región ya no puede llegar a su total. Si una región no tiene jaulas cortadas y su total no cuadra (una suma desplazada), no hay solución.

Las opciones ocultas van a una pila y se devuelven en orden inverso al volver del nodo, como en `cover` y `uncover`. Las cotas, y la cantidad de opciones con la que se evaluó por última vez cada ítem y cada jaula, se guardan por profundidad. Un ítem o una jaula se reevalúa solo si esa cantidad cambió: bajando por la búsqueda las opciones solo se quitan, así que la misma cantidad implica el mismo conjunto.

### Pruebas
- `test/solver-b.test.ts` (T-35.1): en 300 puzzles 4×4 aleatorios (con sumas desplazadas y números iniciales erróneos), B con `limit: Infinity` da exactamente las soluciones de la fuerza bruta y las de A, y los `count` coinciden. También hay casos fijos con 0, 1 y 288 soluciones (con los límites 1, 2 y 5), un total de tablero roto en 9×9, el determinismo y las comprobaciones de entrada.
- `test/solvers-cross.test.ts` (T-35.1, A contra B en 6×6 y 9×9). La función `compare` exige el mismo `count` con el límite por defecto, la misma solución si es única y el mismo número de soluciones con `limit: 13`. Si hay 12 o menos, exige además el mismo conjunto de soluciones. Se aplica a:
  - **Cadenas de números iniciales:** desde un puzzle aleatorio, se agregan números iniciales de su cuadrícula hasta la unicidad y se compara cada paso: muchas soluciones, pocas (conjunto completo) y una (la cuadrícula). Cada ejecución hace unas 80 comparaciones de conjuntos de 2 a 11 soluciones en 6×6 y unas 16 en 9×9, y la prueba exige al menos una.
  - **Variantes** con sumas desplazadas o números iniciales erróneos (0 soluciones) y **totales de tablero rotos**.
  - En 9×9 se parte de 3 números iniciales: sin ellos, B puede tardar segundos (ver mediciones) y la CI sería lenta e irregular. Los 9×9 sin números iniciales se comparan en la medición de abajo y en el corpus de F4d.
- `test/solver-b-pure.test.ts` (T-35.1, B con poda contra Dancing Links puro): la misma función de comparación, entre `solveB` y `solveB` con `prune: false`. En 4×4, 300 puzzles aleatorios (con sumas desplazadas y números iniciales erróneos) con el conjunto completo de soluciones (`limit: Infinity`). En 6×6 sin números iniciales y en 9×9 con 15, cadenas de números iniciales hasta la unicidad y variantes con 0 soluciones. En 9×9 se parte de 15 porque Dancing Links puro se vuelve lento con menos (ver mediciones).
- `test/reference.test.ts` (T-35.2): los 13 puzzles de `test/fixtures/reference-puzzles.ts`, con 0, 1 y de 2 a 4 soluciones en cada tamaño. A y B reproducen el conjunto de soluciones registrado, el validador acepta cada solución y, en 4×4, la fuerza bruta coincide. **Desviación:** no hay fuente pública. Los puzzles se construyeron sobre cuadrículas válidas (el campo `origin` dice cómo) y el resultado lo calcularon A y B con `limit: Infinity` y lo confirmó el validador.

### Mediciones
Las mismas que para A: 1000 puzzles aleatorios por tamaño (`killerArb`, semilla 42, jaulas de 2 a 5 celdas, sin números iniciales), Node 24.21, AMD Ryzen 9 9955HX, un hilo. Tiempo por llamada a `solveB` con `limit = 2`. En los 3000 puzzles, A y B dan el mismo `count`, y la misma solución en los 189 únicos.

| Tamaño | Únicos / 2 o más | Media | Mediana | p90 | p99 | Máximo | Nodos (mediana / p99 / máx.) |
|---|---|---|---|---|---|---|---|
| 4×4 | 69 / 931 | 0,19 ms | 0,16 ms | 0,3 ms | 0,7 ms | 4 ms | 9 / 13 / 17 |
| 6×6 | 26 / 974 | 0,93 ms | 0,88 ms | 1,7 ms | 2,3 ms | 3 ms | 14 / 25 / 25 |
| 9×9 | 94 / 906 | 43 ms | 15 ms | 67 ms | 446 ms | 3,8 s | 34 / 3584 / 31 155 |

**Puzzles únicos**, que son los que verificará F4d: 200 puzzles 9×9 (semilla 7) llevados a la unicidad con números iniciales de su cuadrícula (4,1 de media). A tarda 1,9 ms de media y 27 ms como máximo; B, 13 ms de media, 99 ms en el p99 y 0,7 s como máximo. Coinciden en los 200.

En 9×9, B es unas 6 veces más lento que A de media. Su peor caso son los puzzles **con muchas soluciones y jaulas de 5 celdas**: en uno con 56 soluciones y 15 912 opciones, B necesitó 18 000 nodos y 9 s para encontrar dos. Con 3 números iniciales, el máximo en 300 puzzles bajó a 0,17 s con `limit: 13`.

Cómo se llegó aquí (9×9, 11 puzzles difíciles de la semilla 42, tiempo total):

| Versión | Total | Puzzle único más difícil |
|---|---|---|
| Dancing Links puro (permutaciones por jaula, MRV) | 261 s; 8 de los 11 pasan de 300 000 nodos | 1,5 M nodos, 44 s |
| + regla 3, solo para detectar fallos (cortado en 300 000 nodos) | 116 s; 3 sin terminar | sin terminar |
| + regla 3 podando opciones hasta un punto fijo | 24 s | 33 000 nodos, 16 s |
| + cachés por profundidad y poda solo antes de ramificar | 8 s | 39 500 nodos, 5,7 s |
| + reglas 1 y 2 (versión actual) | 2,1 s | 4 500 nodos, 1,3 s |

**B con poda contra Dancing Links puro** (2026-10-23, semilla 2026; el `count` con `limit: 2`, la solución si es única, las primeras 13 soluciones y el conjunto completo si hay 12 o menos; en 4×4, siempre el conjunto completo). **0 diferencias** en 4307 puzzles:

| Muestra | Puzzles | 0 / 1 / conjuntos de 2 a 12 | Media con poda | Media pura | Máximo puro |
|---|---|---|---|---|---|
| 4×4, variantes | 1000 | 512 / 86 / 402 | 0,37 ms | 0,39 ms | 4 ms |
| 6×6, variantes | 1000 | 698 / 8 / 144 | 1,7 ms | 2,3 ms | 17 ms |
| 6×6, 300 cadenas sin números iniciales | 1568 | 0 / 300 / 796 | 1,6 ms | 2,0 ms | 16 ms |
| 9×9, variantes con 12 números iniciales | 300 | 257 / 13 / 28 | 6,7 ms | 23 ms | 121 ms |
| 9×9, 100 cadenas desde 12 números iniciales | 239 | 0 / 100 / 117 | 5,9 ms | 20 ms | 86 ms |

Cada tiempo suma las dos llamadas de ese lado por puzzle (`limit: 2` y `limit: 13`, o `Infinity` en 4×4). En 9×9 con `limit: 2`, Dancing Links puro tarda de media 4,7 ms con 30 números iniciales, 13 ms con 12, 36 ms con 8 (máximo 0,7 s) y 118 ms con 5 (máximo 1,7 s).

No se adoptaron:
- **Opciones por (celda, dígito) más una opción de combinación por jaula**, sin permutaciones. Es cobertura exacta pura, con una matriz mucho más chica, pero pierde las sumas al ramificar y fue más lenta.
- **dom/wdeg sobre los ítems**, como en A. Dio resultados mixtos: mejoró algunos puzzles con muchas soluciones y empeoró otros, entre ellos el único más difícil.
- **Pares de cajas y bloques de 2 × 2 cajas** como regiones: casi no reducen nodos y encarecen cada uno.
- Ramificar solo sobre ítems de celda o solo sobre ítems de dígito: peor que MRV sobre todos.

## Generador (F4d)

`generatePuzzle({ seed, geometry = 9×9, easyGivens = 0, maxNodes = 1000, maxAdjustments = 40, maxCandidates = 1000, cageSizeWeights = [3, 4, 2, 1] })` → `{ puzzle, solution, givensReason, stats }`.
- `seed`: entero de 32 bits sin signo. Con la misma semilla y las mismas opciones, el resultado es idéntico (T-35.6). `GENERATOR_VERSION` cambia cuando un cambio del generador altera lo que sale de una semilla.
- `givensReason` (SPEC §2.2, R-20): `none` sin números iniciales; `uniqueness` si hicieron falta para la unicidad; `easy` si se pidieron `easyGivens` (aunque también haya alguno de unicidad).
- `stats`: candidatos empezados y descartados, particiones repetidas, reajustes de jaulas y números iniciales de unicidad del puzzle aceptado, y nodos de A (en todos los candidatos) y de B (en la verificación).
- Lanza `RangeError` con opciones inválidas y `Error` si ningún candidato se acepta en `maxCandidates` o si los solvers discrepan.

### Módulos (`src/generator/`)

| Módulo | Contenido |
|---|---|
| `rng.ts` | `createRng(seed)`: SFC32 sembrado con SplitMix32 (para que semillas vecinas den secuencias sin relación). `int(bound)` por rechazo, sin sesgo de módulo. `shuffle` (Fisher-Yates) y `weightedIndex`. |
| `grid.ts` | `randomGrid`: backtracking con MRV y candidatos en orden aleatorio. |
| `cages.ts` | `partitionCages` y `recut`. |
| `generate.ts` | `generatePuzzle`. |

### Algoritmo
1. **Cuadrícula** completa aleatoria.
2. **Jaulas.** Las celdas se recorren en orden aleatorio. Cada celda libre empieza una jaula con un tamaño objetivo de 2 a 5 elegido con `cageSizeWeights`, y crece agregando vecinas libres al azar que no repitan dígito, hasta el objetivo o hasta quedarse sin vecinas. Una celda que queda sola se une a una jaula vecina con lugar y sin su dígito; si no hay ninguna, se vuelve a partir (`partitionRetries`).
3. **Sumas**, desde la cuadrícula.
4. **Unicidad** con `solveA` y `maxNodes`. Si A agota el presupuesto en cualquier llamada, el candidato se **descarta entero** y se genera otro desde el paso 1.
5. **Reajuste.** Con dos soluciones, se toma una celda donde difieren y se vuelve a cortar su jaula: se parte en dos si tiene 4 o 5 celdas y, si no, se recorta junto con una jaula vecina en dos jaulas nuevas. Las jaulas salen siempre de la cuadrícula, así que esta sigue siendo solución. Tras `maxAdjustments` reajustes (o si ningún corte es posible), se agrega en una de esas celdas el número inicial de la cuadrícula. Se repite el paso 4 hasta la unicidad.
6. Con `easyGivens`, se agregan esos números iniciales en celdas al azar.
7. **Verificación**: `validateStructure`, `validateSolution` y **`solveB`**, que tiene que encontrar una sola solución, la misma. Si no, es un error de un solver y se lanza `Error`.

### Pruebas
- `test/rng.test.ts` (T-35.6): misma semilla, misma secuencia; semillas vecinas distintas; `int` uniforme (chi-cuadrado); `shuffle` es una permutación; entradas inválidas.
- `test/generator.test.ts`, versión rápida en la CI con semillas aleatorias en 4×4, 6×6 y 9×9: propiedades T-20.1 y T-20.2 (`test/helpers/generated.ts`: estructura válida, jaulas de 2 a 5 celdas sin repetidos y con su suma, solución única para A y para B sin presupuesto, números iniciales de la solución y su motivo), T-35.6 (mismo resultado con la misma semilla y opciones, incluidos `easyGivens`), sin reajustes la unicidad viene de números iniciales, el descarte por presupuesto (con `maxNodes: 2`, el puzzle aceptado en el candidato `c` hace fallar `maxCandidates: c − 1`) y las opciones inválidas.
- `test/generator.corpus.test.ts` (T-20.1, T-35.1): **1000 puzzles 9×9** (semillas 1 a 1000) con unicidad confirmada por A y por B sin presupuesto, todos distintos. Imprime el tiempo de generación y los descartes. No corre en `pnpm test` (excluido en `vitest.config.ts`): `pnpm test:corpus` en local y el workflow `corpus.yml`, programado cada lunes con semillas nuevas (desde `run_number × 1000`) y manual con la semilla y la cantidad que se elijan. Si falla, el mensaje dice la semilla, que se agrega como caso fijo.

### Mediciones
Semillas 1 a 1000, opciones por defecto, Node 24.21, AMD Ryzen 9 9955HX, un hilo. El tiempo es el de `generatePuzzle` completo, verificación con B incluida.

| Tamaño | Puzzles | Media | Mediana | p90 | p99 | Máximo | Descartados por presupuesto | Con números iniciales de unicidad |
|---|---|---|---|---|---|---|---|---|
| 9×9 (corpus) | 1000 | **39 ms** | 36 ms | 64 ms | 103 ms | 137 ms | 1 de 1001 candidatos (0,1 %) | 7 (0,7 %) |
| 6×6 | 300 | 7,9 ms | 6,0 ms | 15 ms | 37 ms | 45 ms | 0 | 7 (2,3 %) |
| 4×4 | 300 | 4,7 ms | 3,0 ms | 9,9 ms | 23 ms | 41 ms | 0 | 78 (26 %) |

- En 9×9, de los 39 ms, la verificación con B se lleva unos 15 ms de media (108 ms como máximo) y la última llamada a A, 2 ms. El resto son la cuadrícula, las particiones y unos 8,7 reajustes de media, cada uno con su llamada a A.
- Jaulas en 9×9: 28,6 por puzzle; el 47 % de 2 celdas, el 31 % de 3, el 15 % de 4 y el 7 % de 5. Los reajustes parten jaulas, así que empujan hacia las chicas. La dificultad se calibra en F5 (`cageSizeWeights` y el calificador).
- En 4×4 hay pocas formas de cortar un tablero tan chico, y una cuarta parte necesita números iniciales.

**Presupuesto de nodos de A** (9×9, semillas 1 a 1000, 40 reajustes):

| `maxNodes` | Candidatos descartados | Media | Máximo |
|---|---|---|---|
| 10 | 396 de 1396 (28 %) | 36 ms | 108 ms |
| 30 | 83 de 1083 (7,7 %) | 37 ms | 150 ms |
| 100 | 10 de 1010 (1,0 %) | 38 ms | 123 ms |
| 300 | 2 de 1002 (0,2 %) | 37 ms | 138 ms |
| **1000** (por defecto) | 1 de 1001 (0,1 %) | 39 ms | 137 ms |
| sin límite | 0 | 37 ms | 437 ms |

Los presupuestos chicos casi no cambian la media: la mayoría de los candidatos se resuelven con pocos nodos, y los descartados se reemplazan rápido. Se eligió 1000 porque descarta muy poco (el p99 de A en puzzles 9×9 aleatorios es de 763 nodos, ver solver A) y aun así corta la cola: sin límite, un candidato llegó a 437 ms. Con `maxNodes: 2`, A no puede ramificar, y aun así se aceptan puzzles: la propagación de A los resuelve en la raíz. Eso es dato para el calificador (F4e).

**Reajustes de jaulas** (9×9, sin límite de nodos): con 10 reajustes, el 30 % de los puzzles necesita números iniciales (100 semillas); con 20, 40 y 80, el 9,5 %, el 1,5 % y el 1 % (200 semillas). Se eligió 40. Lo que queda son puzzles en los que ningún corte cerca de las celdas que difieren es posible.

## Calificador (F4e y F4f)

`grade(puzzle, { trace = false })` → `{ status, maxLevel, steps, stepsByLevel, unplaced, trace? }`.
- `status`: `solved` si las técnicas llenan el tablero; `exceedsTechniques` si se quedan sin deducciones antes; `contradiction` si una celda se queda sin candidatos o el tablero lleno no cumple las sumas (solo en puzzles sin solución). **Nunca adivina:** no hay búsqueda.
- `maxLevel`: el nivel de la técnica más difícil que hizo falta (`graderMaxLevel`, SPEC §2.2), o `UNRATED` si no terminó. `steps` es `graderSteps`, y `stepsByLevel[level]` son los pasos de cada nivel.
- `trace`: los pasos en orden, cada uno con su técnica, su nivel y sus deducciones.
- Exige una estructura válida (`validateStructure`); si no, lanza `RangeError`. Es determinista.

`levelToDeduce(cell, { puzzle, values })` → un nivel entre 1 y `UNRATED` (T-35.5).
- `values`: los `size²` dígitos colocados (0 si la celda está vacía). **Solo los dígitos colocados, nunca las notas:** el tipo no tiene notas. Los números iniciales se aplican igual.
- Es el nivel mínimo con el que la celda queda con un solo candidato desde ese estado. Si el estado es contradictorio, devuelve `UNRATED`. Lanza `RangeError` si la celda no existe, ya tiene un dígito o `values` no tiene esa forma.
- El servidor lo llama antes de aplicar cada jugada correcta (`PlacementContext`, SPEC); F6 lo usa para puntuar.

Constantes: `MAX_TECHNIQUE_LEVEL = 5` (el nivel más alto implementado; era 3 en F4e) y `UNRATED = 6`. `UNRATED` es fijo, no `MAX_TECHNIQUE_LEVEL + 1`, para que un nivel guardado no cambie de sentido al agregar técnicas.

### Módulos (`src/grader/`)

| Módulo | Contenido |
|---|---|
| `types.ts` | `Deduction` (`place` o `eliminate`, con celda y dígito), `Technique` (`id`, `level` y `find`), `MAX_TECHNIQUE_LEVEL` y `UNRATED`. |
| `context.ts` | `graderContextOf(puzzle)`: unidades, jaulas, pares (con la jaula), matriz de pares, grupos de la regla del 45 y las memorias de los filtros. Memoizado por objeto (`WeakMap`), como `layoutOf`. |
| `state.ts` | Candidatos y dígitos colocados. Colocar un dígito lo quita de los candidatos de sus pares (fila, columna, caja y jaula), como la limpieza de notas. |
| `sum-group.ts` | Filtro exacto de celdas con suma conocida (`sumSupport`, con memoria y con dígitos que la asignación tiene que usar, `mustUse`) y cotas de suma (`sumBounds`). |
| `singles.ts`, `cages.ts`, `rule45.ts` | Las técnicas de los niveles 1, 2 y 3. |
| `interactions.ts`, `subsets.ts` | Nivel 4: locked candidates y jaula obligada por una unidad; pares y tríos desnudos y ocultos. `subsets.ts` tiene también las ayudas comunes (`combinations`, `eliminationCollector`). |
| `fish.ts`, `unit-combination.ts` | Nivel 5: X-Wing, Swordfish e Y-Wing; combinaciones de unidad. |
| `grade.ts` | `TECHNIQUES`, `grade` y `levelToDeduce`. |

### Técnicas
Cada técnica es una función aislada (`find`): lee el estado sin modificarlo y devuelve las deducciones que encuentra en él (colocar un dígito o quitar un candidato), todas válidas a la vez. Su nivel va con ella (`Technique.level`).

| Nivel | Técnica | Qué deduce |
|---|---|---|
| 1 | `nakedSingle` | Una celda vacía con un solo candidato: se coloca. |
| 1 | `hiddenSingle` | Un dígito que en una fila, columna o caja cabe en una sola celda. |
| 1 | `cageLastCell` | La última celda vacía de una jaula vale la suma menos las demás. |
| 2 | `cageCombination` | Un candidato que no aparece en ninguna forma de llenar la jaula con su suma, sin repetir dígito, sale de la celda. |
| 2 | `cageForcedDigit` | Un dígito que está en todas las combinaciones posibles de la jaula: si solo una celda lo admite, va ahí; si no, sale de las celdas de fuera de la jaula que ven a todas las que lo admiten. |
| 3 | `innieOutie` | Regla del 45: los innies y los outies de una región son una jaula virtual. Con una celda sin resolver, vale la suma menos las demás; con hasta 5, filtro exacto (sin repetir dígito entre pares); con más, cotas de suma. |
| 4 | `lockedCandidates` | Un dígito que una fila, columna o caja tiene que usar y que solo cabe en celdas que ve otra celda sale de esa celda (pointing y claiming, y también a través de jaulas, porque sus celdas son pares). |
| 4 | `nakedPair`, `nakedTriple` | 2 o 3 celdas vacías de una unidad o jaula cuyos candidatos juntos son 2 o 3 dígitos: esos dígitos salen de toda celda que las vea a todas. |
| 4 | `hiddenPair`, `hiddenTriple` | 2 o 3 dígitos que una unidad tiene que usar (o que son obligatorios en una jaula) y que solo caben en 2 o 3 de sus celdas: esas celdas pierden los demás candidatos. |
| 4 | `cageUnitLock` | Si en una unidad un dígito solo cabe en celdas de una misma jaula, la jaula tiene que usarlo: se descartan sus combinaciones sin él. |
| 5 | `xWing`, `swordfish` | Peces de 2 y 3 líneas: si en 2 (o 3) filas un dígito solo cabe en 2 (o 3) columnas, sale del resto de esas columnas; igual cambiando filas por columnas. |
| 5 | `yWing` | Un pivote {a, b} que ve una celda {a, c} y otra {b, c}: c sale de las celdas que ven a las dos. |
| 5 | `unitCombination` | Una fila, columna o caja entera con las jaulas que la tocan: un candidato que no aparece en ninguna forma de llenar la unidad con todos sus dígitos, en la que cada jaula cuadre (entera dentro, con su suma; si sobresale, completable fuera con sus candidatos y sin repetir dígito), sale de la celda. |

Dentro de un nivel, el orden de `TECHNIQUES` es el de la tabla (en el nivel 4: `lockedCandidates`, `nakedPair`, `hiddenPair`, `cageUnitLock`, `nakedTriple` y `hiddenTriple`). No cambia el nivel de ningún puzzle ni de ninguna celda, solo los pasos.

**Combinaciones de unidad** (`unitSupport`): para cada jaula que toca la unidad se enumeran las formas de llenar sus celdas de dentro (sin repetir dígito, con cotas de suma y comprobando que la jaula se completa fuera), agrupadas por el conjunto de dígitos que usan. Después se combinan las jaulas sin repetir dígito: hacia adelante, los conjuntos de dígitos alcanzables tras cada jaula; hacia atrás, los que todavía llegan a usar todos los dígitos. Un conjunto de una jaula vale si une un estado alcanzable con uno que termina, y sus formas dan el soporte. Es exacto y crece con los conjuntos de dígitos (como mucho 2^size por jaula), no con las permutaciones. La primera versión hacía búsquedas dirigidas por (celda, dígito), como `sumSupport`, y tardaba 2,4 veces más. Tiene memoria por unidad, como los grupos del 45.

Regiones de la regla del 45: cada fila, columna y caja, y cada unión de 2 a `size − 1` filas o columnas consecutivas. Una región de `k` unidades suma `k · size · (size + 1) / 2`. Restando las jaulas que caben enteras, quedan la suma de los innies (las celdas de la región en jaulas que sobresalen) y la de los outies (las celdas de esas jaulas que quedan fuera). Los grupos se calculan una vez por puzzle, sin repetir conjuntos de celdas.

**Filtro exacto** (`sumSupport`): por cada (celda, dígito) todavía sin soporte se busca una asignación que lo use, que dé la suma y que no repita dígito entre pares; la asignación encontrada da soporte a todas sus celdas. Un dígito es obligatorio si ninguna asignación lo evita. Poda con las cotas de suma y, si todas las celdas son pares entre sí, con la suma mínima y máxima de los dígitos libres. Las celdas resueltas no ramifican.

### Algoritmo
`grade` repite: prueba las técnicas en el orden de `TECHNIQUES` (de menor a mayor nivel) y aplica **todas las deducciones de la primera que encuentra algo**; eso es un paso. Después vuelve a empezar desde el nivel 1. Así, un nivel solo se usa cuando ninguna técnica de un nivel inferior deduce nada. Termina cuando el tablero está lleno o ninguna técnica encuentra nada.

`levelToDeduce` aplica el mismo bucle desde el estado dado hasta que la celda queda con un solo candidato, y devuelve el nivel más alto que usó (al menos 1). Ese nivel es el mínimo. Las reglas son monótonas (con menos candidatos deducen lo mismo o más), así que lo que deducen las técnicas de nivel ≤ L desde un estado es un punto fijo único. Las de los niveles 4 y 5 también lo son: un patrón solo se ignora cuando una de sus celdas queda resuelta, y lo que habría deducido lo deducen entonces los singles. El bucle usa el nivel L solo después de llegar al punto fijo de los niveles inferiores, en el que la celda todavía no estaba determinada. Por la misma monotonía, agregar celdas correctas no sube el nivel (T-35.5).

**Memoria por jaula y grupo.** El filtro exacto depende solo de los candidatos de sus celdas, así que el contexto guarda el último resultado de cada jaula y de cada grupo, con las máscaras con que se calculó, y lo reutiliza si no cambiaron. No cambia ningún resultado: lo comprueba la prueba de determinismo con y sin memoria.

### Pruebas
- `test/grader.test.ts` (T-35.4 y T-35.5), en la CI, con puzzles de `generatePuzzle` en 4×4, 6×6 y 9×9 (algunos con `easyGivens`):
  - Se reproduce la traza de `grade` con un estado propio. Antes de cada paso, ninguna técnica anterior en `TECHNIQUES` encuentra nada (**menor nivel primero**). La técnica del paso encuentra exactamente esas deducciones, **ninguna contradice la solución** (no coloca un dígito equivocado ni quita el correcto) y, después de aplicarlas, el dígito de la solución sigue entre los candidatos de cada celda. Si termina, el tablero es la solución; si no, ninguna técnica encuentra nada (no adivina).
  - Desde estados con celdas correctas al azar, ninguna deducción de ninguna técnica contradice la solución.
  - En 4×4 con cualquier número de soluciones (con la fuerza bruta como oráculo, y a veces con una suma desplazada para que no haya ninguna), cada deducción vale en todas las soluciones; con varias, el resultado es `exceedsTechniques`; sin ninguna, nunca `solved`.
  - `levelToDeduce`: entre 1 y `UNRATED`; vale 1 si la celda tiene un solo candidato o la coloca una técnica de nivel 1; no sube al agregar celdas correctas; no pasa del `maxLevel` de `grade`; desde el tablero vacío sin números iniciales es al menos 2. Casos fijos de naked single, hidden single y última celda de jaula.
  - Oráculos independientes en el tablero vacío: `cageCombination` deja exactamente los dígitos de las combinaciones de cada jaula, y `cageForcedDigit` quita exactamente sus dígitos obligatorios de las celdas que ven toda la jaula (combinaciones por enumeración directa de subconjuntos). Las sumas de los grupos del 45 coinciden con la solución.
  - Determinismo, con y sin memoria, y entradas inválidas.
- `test/grader-advanced.test.ts` (F4f, T-35.4), en la CI, con estados que todavía admiten la solución: dígitos correctos colocados y candidatos equivocados quitados al azar (como las notas de un jugador), que es lo que hace aparecer los patrones de los niveles 4 y 5.
  - Desde esos estados, en 4×4, 6×6 y 9×9, ninguna deducción de ninguna técnica contradice la solución.
  - Cada técnica de los niveles 4 y 5 deduce exactamente lo mismo que un oráculo por fuerza bruta escrito aparte (subconjuntos por máscara; permutaciones completas de la unidad para `unitCombination`), en 4×4 y 6×6, y en 9×9 salvo `unitCombination`.
  - Cada una de esas técnicas deduce algo en alguno de 400 estados 6×6, para que la comparación con su oráculo no sea vacía.
- `test/grader.corpus.test.ts`: los 1000 puzzles del corpus (semillas 1 a 1000) con la misma reproducción de la traza. Mide `grade` y simula 100 partidas para medir `levelToDeduce`. Corre con `pnpm test:corpus` y en el workflow `corpus.yml`.

### Mediciones
Semillas 1 a 1000 (9×9, opciones por defecto del generador), Node 24.21, AMD Ryzen 9 9955HX, un hilo. **Niveles 1 a 5 (F4f): 401 109 deducciones, 0 contra la solución.**

| Nivel máximo | Puzzles (F4f) | Con los niveles 1 a 3 (F4e) |
|---|---|---|
| 1 | 0 | 0 |
| 2 | 100 (10,0 %) | 100 |
| 3 | 668 (66,8 %) | 668 |
| 4 | 77 (7,7 %) | — |
| 5 | 85 (8,5 %) | — |
| Exceden las técnicas | **70 (7,0 %)** | 232 (23,2 %) |

- Ningún puzzle es de nivel 1: sin números iniciales no hay ningún single al empezar, y hace falta al menos una combinación de jaula. Con `easyGivens` puede haberlos (F5).
- Los niveles 4 y 5 resuelven 162 de los 232 puzzles que excedían los niveles 1 a 3. Los niveles 2 y 3 no cambian: las técnicas nuevas solo se usan cuando las anteriores no deducen nada.
- Pasos por puzzle: mediana 51, máximo 98. Pasos por nivel en todo el corpus: 35 831 de nivel 1, 11 458 de nivel 2, 2030 de nivel 3, 634 de nivel 4 y 245 de nivel 5.
- Pasos por técnica de los niveles 4 y 5: `lockedCandidates` 412, `cageUnitLock` 134, `nakedPair` 49, `hiddenPair` 20, `nakedTriple` 17, `hiddenTriple` 2, `xWing` 1, `yWing` 0, `swordfish` 0 y `unitCombination` 244. En killer, las técnicas de jaula y de unidad hacen casi todo el trabajo: Y-Wing y Swordfish no se usaron nunca en el corpus, porque antes deduce algo otra técnica. Se quedan porque son correctas (tienen su oráculo y deducen en estados al azar) y baratas, y otros puzzles pueden necesitarlas.

**Tiempo de `grade`** (primera llamada por puzzle, sin memoria previa): media 25 ms, mediana 20 ms, p95 59 ms, p99 84 ms y máximo 130 ms (con los niveles 1 a 3, media 11 ms). Lo que más cuesta es `unitCombination`.

**Tiempo de `levelToDeduce`**, que se ejecutará en el servidor en cada jugada correcta. Se simularon 100 partidas sobre los primeros puzzles del corpus: las celdas vacías se llenan con la solución en un orden aleatorio con semilla, y antes de cada jugada se mide la llamada, como hará el servidor. 8099 llamadas, medidas sin otra carga en la máquina:

| Técnicas | Media | Mediana | p95 | p99 | Máximo |
|---|---|---|---|---|---|
| **Niveles 1 a 5 (F4f)** | **1,50 ms** | 0,09 ms | **9,2 ms** | 20,6 ms | 85 ms |
| Niveles 1 a 3 (F4e) | 0,77 ms | 0,06 ms | 4,7 ms | 11,5 ms | 30 ms |

- El p95 queda muy por debajo del límite de 50 ms pedido para F4f. El coste depende de cuánto falta deducir: casi todas las jugadas de media partida son singles, y lo más caro son las primeras jugadas, que recorren casi toda la resolución.
- Resultados de esas llamadas: 6190 de nivel 1, 1574 de nivel 2, 291 de nivel 3, 24 de nivel 4, 7 de nivel 5 y 13 `UNRATED` (con los niveles 1 a 3 eran 44 `UNRATED`).
- Monotonía (T-35.5), comprobada además con un script aparte: en 200 puzzles (semillas 5000 a 5199), 3 celdas por puzzle y 15 tandas de 4 celdas correctas agregadas, 9000 comparaciones sin ninguna subida y ningún nivel por encima del `maxLevel` de `grade`.
- Cómo se llegó a los tiempos de F4e (`grade`, 100 puzzles). Enumerando todas las asignaciones de cada jaula y grupo en cada pasada, 37 ms de media. Con la memoria por jaula y grupo, 14 ms: el 70 % del tiempo era volver a filtrar jaulas sin cambios. Con búsquedas dirigidas por (celda, dígito) en vez de la enumeración completa, 11 ms: un grupo de 5 celdas que pueden repetir dígito llegaba a 9⁵ asignaciones. Con la poda por dígitos libres, unos 9 ms.
