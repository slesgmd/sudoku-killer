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
- Los solvers recorren máscaras de candidatos en `Uint16Array` millones de veces por puzzle (el generador llama al solver en cada intento, y T-35.4 exige 1000 puzzles verificados por A y B). Con `noUncheckedIndexedAccess`, cada lectura es `number | undefined`; una comprobación o una llamada a `at` en esos bucles añade una rama y una llamada por acceso, sin aportar seguridad.
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

## Solvers, generador y calificador
Se documentan en F4b–F4f.
