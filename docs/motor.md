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

## Solver B, generador y calificador
Se documentan en F4c–F4f.
