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

`solveA(puzzle, { limit = 2 })` → `{ count, solutions, nodes }`.
- `count`: 0 (sin solución), 1 (una) o 2 (dos o más). Con `limit = 1`, 1 significa «al menos una».
- `solutions`: las encontradas, como mucho `limit`, en el orden de la búsqueda. `limit` es un entero ≥ 1 o `Infinity` (las pruebas lo usan para enumerarlas todas).
- `nodes`: estados propagados, incluida la raíz.
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

## Generador y calificador
Se documentan en F4d–F4f.
