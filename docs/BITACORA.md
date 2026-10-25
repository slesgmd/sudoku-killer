# Bitácora

Historial detallado del proyecto: qué se hizo, problemas, soluciones y tiempo real dedicado. Entradas en orden cronológico (la más reciente al final). No se carga automáticamente; se consulta cuando hace falta.

---

## 2026-10-22 — F0: Entorno y arranque

**Hecho:**
- Plan actualizado a la versión 1.02: en F1 la referencia a la skill "rea-guia" se reemplazó por la skill oficial `reverse-engineer-anything`, con la indicación de verificar con `binary_session` las herramientas de navegador.
- Entorno verificado:
  - Node v24.21.0
  - pnpm 12.12.1
  - Git 2.54.0.windows.1 (usuario global configurado)
  - REA (servidor MCP `rea-agents`) 6.7.0: `binary_session` responde; `inspect_web_page` y `capture_browser_scenario` disponibles (`available: true`). Los proveedores de ADB no están disponibles (no hacen falta para la v1).
- `git init` con rama `main` y `.gitignore` (dependencias, builds, cobertura, `.env`, evidencia local de REA, archivos de editores y del sistema operativo).
- Creados `CONTEXTO.md`, `docs/BITACORA.md`, `docs/IDEAS_FUTURAS.md` (primera entrada: modo competitivo) y `docs/adr/README.md` (plantilla e índice).
- Primer commit.

**Problemas y soluciones:**
- `git config --global init.defaultBranch` no estaba definido. Se usó `git init -b main` y no se cambió la configuración global.
- Git avisaba de conversiones LF→CRLF porque `core.autocrlf` está activo en Windows. Se agregó `.gitattributes` con `* text=auto eol=lf` para que el repositorio sea consistente con la CI de Linux (F3).
- La salida de `binary_session` es muy grande (unos 68 000 caracteres). Para consultarla conviene filtrar `tool_availability.groups` por nombre de herramienta en lugar de leerla entera.

**Tiempo real:** unos 0,1 h en una sola sesión, sin contar la revisión del usuario.

**Siguiente:** F1, estudio de referencia con REA. Hay que empezar en modo plan y proponer las subtareas.

## 2026-10-22 — F0: verificación de criterios de aceptación

- Revisados: `docs/IDEAS_FUTURAS.md` (el modo competitivo es la primera entrada), `docs/adr/README.md` (versionado) y las horas reales de F0 en el plan (~0,1 h). Todo estaba en orden.
- Corregido: el estado de F0 en el plan decía "Terminada" en lugar de "Hecha". Se cambió en la tabla de fases, en el estado global y en la sección de F0.

## 2026-10-22 — F1: Estudio de referencia con REA

**Hecho:**
- Verificación de REA con `binary_session`: `rea-agents` 6.7.0 (paquete y servidor), cliente MCP. `inspect_web_page`, `capture_browser_scenario` e `inspect_web_network_capture` disponibles.
- Subtareas propuestas en modo plan y aprobadas con cambios del usuario: usar siempre `/es/killer`, agregar los puntos propios del killer (sumas de jaula, resaltado de jaula, contador de dígitos, limpieza de notas) y exportar la evidencia a `evidence/f1-referencia.json`.
- F1.1: Chrome sin interfaz, con perfil temporal en el scratchpad y CDP en `127.0.0.1:9333`. `inspect_web_page` pasivo sobre `/es/killer` (E1).
- F1.2: `export_web_scripts` (E2) y lectura estática del bundle `ref-game.8da14029.js`. Resultados: niveles iniciales incluidos en el bundle y luego `/api/level/{dificultad}?mode=killer`; formato `{id, mission, solution, cages, win_rate}`; sumas de jaula calculadas en el cliente; validación en el navegador; fórmula de puntuación basada en velocidad.
- F1.3: escenario A (E3). La carga en frío confirmó que la primera partida no pide nada a la API. La navegación a experto superó los 45 s y no se completó.
- F1.4: escenario B (E4), 29 pasos sobre el nivel fácil inicial, cuya solución estaba en el bundle. Se vieron: errores 0/3 → 3/3 y aviso de fin de partida, temporizador detenido, tecla del dígito completo deshabilitada, puntuación +5/+50/+50 y pistas iniciales 3.
- F1.5 (notas, deshacer, pista, pausa) no se ejecutó. Lo que faltaba quedó marcado en `docs/referencia.md` como visto en el código o inferido, y se listaron 14 preguntas abiertas.
- `docs/referencia.md` escrito. Evidencia exportada a `evidence/f1-referencia.json` (4 registros). `evidence/` agregado a `.gitignore`.
- Plan 1.03: pregunta abierta de pistas en F2 y modelo de comparación basado en velocidad en la simulación de F6.

**Problemas y soluciones:**
- `inspect_web_page` no navega: solo observa una pestaña ya abierta. Se lanzó un Chrome propio con perfil temporal y se abrió la pestaña con `PUT /json/new`.
- Las respuestas de `capture_browser_scenario` superan el límite del transporte MCP (unos 10 MB) por el tráfico de publicidad. La evidencia queda guardada en REA: se exporta con `export_evidence_bundle` y se lee con scripts de Node en el scratchpad.
- La carga de la página tarda unos 100 s por la publicidad. Hay que usar `wait_for` sobre `#game canvas` con límites de tiempo amplios.
- El tablero es un `<canvas>` y REA guarda los valores de storage como hashes. Notas y resaltado no se pueden observar sin capturas de pantalla, que se descartaron porque el entregable no las admite.
- Dos cargas seguidas fallaron: en modo launch con storage precargado ("Scenario navigation failed…") y en modo connect, con el HTML bloqueado (`net::ERR_BLOCKED_BY_RESPONSE`). No se sabe si es un límite del sitio o un problema de la herramienta. El usuario decidió no hacer más cargas automáticas.
- Falta el dato del usuario: pidió agregar "3 respuestas" como observaciones manuales, pero en el mensaje quedó el texto de plantilla. La sección 15 de `referencia.md` queda pendiente.

**Tiempo real:** unos 0,6 h en una sesión, sin contar la revisión del usuario.

**Siguiente:** agregar las 3 observaciones manuales del usuario a `docs/referencia.md` (sección 15). Después, F2 en modo plan.

## 2026-10-22 — F2: Especificación y arquitectura

**Hecho:**
- F2.0: la sección 15 de `referencia.md` quedó marcada como "Descartada: las reglas propias ya cubren estos puntos" y se quitó el pendiente de `CONTEXTO.md` (commit aparte).
- Subtareas propuestas en modo plan. Las preguntas de producto se hicieron **en una sola ronda**, nueve preguntas (P1–P9) y once decisiones por defecto (D1–D11), cada una con su opción recomendada. El usuario aceptó todo con estos cambios:
  - P1: la pista le cuesta −H a quien la usa.
  - P7: deshacer una nota grupal solo se aplica si nadie la modificó después.
  - D3: quien sale y vuelve con ficha recupera vidas y puntos, y nunca vuelve con 3 vidas nuevas.
  - D6: redacción precisa.
  - Al aprobar el plan agregó dos correcciones: el apodo queda reservado hasta el fin de la partida, y el estado "salió" se suma al eje de conexión.
- `docs/SPEC.md`:
  - Decisiones de producto y resolución con dueño de las 15 preguntas abiertas.
  - Modelo de datos y máquinas de estado. La del jugador se modela en dos ejes independientes, rol y conexión.
  - Protocolo v1 con sobre, catálogo, errores, snapshot, idempotencia, versionado y límites.
  - Interfaz `GameMode`.
  - 34 reglas (R-01 a R-34) con sus casos T-xx, 24 casos límite y un plan de pruebas con inspector de filtración y matriz de cobertura.
- ADR 0001–0005 escritos y aceptados, con el índice en `docs/adr/README.md`.
- `IDEAS_FUTURAS.md`: se agregaron el ranking acumulado, el chat y las reacciones, el contrarreloj y la identidad persistente.
- Plan 1.04: F2 hecha, paquete `packages/game` y ajustes en F3, F4, F6 y F9.

**Problemas y soluciones:**
- Había dos huecos entre reglas, pero ninguna contradicción.
  - Un jugador que **expira** y vuelve con su ficha recibiría 3 vidas nuevas según la regla de "entrada con partida en curso", y eso se podía aprovechar desconectándose 2 minutos. Se resolvió como en D3: recupera sus datos, y el plazo de 2 minutos solo garantiza el asiento (D3' en la SPEC). El usuario lo confirmó al aprobar el plan.
  - El usuario mencionó una "regla 9" para la celda bloqueada. Se interpretó como la regla de celda bloqueada / "ya resuelta", que en la SPEC es R-05.
- La cadena lineal de estados del jugador del plan (`activo → espectador → desconectado → expirado`) no representa a un espectador desconectado. Se separó en dos ejes y quedó documentado como un refinamiento.
- El reductor de la partida tiene que ser compartido por el servidor, la reconstrucción y el servidor simulado del cliente (F8), y no encajaba en `engine` ni en `scoring`. Se creó `packages/game` (ADR 0004).

**Tiempo real:** unos 0,4 h (12:39 a 13:05 aproximadamente), en una sesión. Incluye la ronda de preguntas, pero no el tiempo de revisión del usuario.

**Siguiente:** F3, monorepo y calidad, en modo plan.

## 2026-10-22 — F3: Monorepo y calidad

**Hecho:**
- El usuario pidió ejecutar F3 sin pedir confirmación salvo errores, así que no se pasó por el modo plan.
- Revisión previa de R-05 (SPEC 1.1). La regla ya cubría las jugadas simultáneas, pero decía que "la segunda" recibe siempre `already_solved`, y eso contradice E-03 cuando la primera es un error. Se reescribió: gana la primera que procesa la cola de la sala; si es un acierto, las siguientes reciben `already_solved` sin penalización ni evento; si es un error, la celda no se bloquea. Se agregó T-05.5 (error y después acierto en la misma tanda) y se actualizaron E-03 y la matriz de cobertura. Commit aparte.
- Monorepo pnpm:
  - `packages/{engine,protocol,scoring,game}` y `apps/{server,web}`.
  - `tsconfig.base.json` con `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` y `erasableSyntaxOnly`.
  - Los paquetes exportan sus fuentes con la condición `@sudoku-killer/source`, y `dist/` en otro caso. Los imports relativos llevan `.ts` con `rewriteRelativeImportExtensions`.
- ESLint 10 con `strictTypeChecked` y `stylisticTypeChecked`, `react-hooks` en la web y `no-restricted-properties` contra `Date.now` y `Math.random` en `engine`, `scoring` y `game`. Prettier 3.9 (los `.md` se excluyen para conservar el formato manual).
- Vitest 5 con una sola configuración en la raíz. Pruebas:
  - Ejemplo `cellIndex` en `engine`, con fast-check.
  - T-31.3: recorre con la API del compilador todos los tipos y valores exportados por `protocol` y busca `solution`. Un fixture de control con una interfaz, un `Record`, un esquema Zod, un `z.infer` y una función confirma que el detector encuentra los cinco.
  - Regla de lint: un test con ESLint comprueba que la regla salta en los tres paquetes puros y no en `server` ni en `protocol`.
- Husky 9 y lint-staged 17 en el pre-commit. Se comprobó que un commit con `Date.now()` en `engine` queda bloqueado.
- CI en GitHub Actions: checkout v7, pnpm/action-setup v6 y setup-node v7 con Node desde `.node-version`; `pnpm install --frozen-lockfile`, `check`, `test` y `build`. Primer run en verde en 28 s (39851785929).
- Verificaciones manuales: el servidor arranca desde `dist/` y desde las fuentes (`node --conditions`), y Vite dev sirve la web resolviendo `protocol` desde sus fuentes.

**Problemas y soluciones:**
- El último TypeScript es el 7.0 (compilador nativo), pero `typescript-eslint` 8.72 solo admite `<6.1`, y el test T-31.3 necesita la API de JS. Se fijó TypeScript 6.0.3 y quedó anotado en el ADR 0001.
- Con TypeScript 6, `types` vale `[]` por defecto. Los tipos de Node se dan en el `tsconfig.json` de cada paquete (que incluye `test/`), pero no en `tsconfig.build.json`, así que `src` no puede usar Node sin que falle el build.
- La primera versión del detector de T-31.3 recorría todo el grafo de tipos de Zod y superaba los 5 s. Ahora, de los tipos de librerías solo recorre los argumentos de tipo. Los tipos mapeados (como `Writeable<T>` de Zod) sí se recorren, porque sin eso no se detectaba el esquema. Tarda unos 2 s.
- El repositorio de GitHub era público, aunque se describió como privado. Se le preguntó al usuario antes del push y decidió dejarlo público.

**Tiempo real:** unos 0,3 h (15:33 a 15:50 aproximadamente), en una sesión. No incluye el tiempo de revisión del usuario.

**Siguiente:** F4, motor del puzzle, en modo plan.

## 2026-10-22 — F4: plan por subfases y F4a (modelo, validador y `cleanupPeers`)

**Hecho:**
- Plan de F4 en modo plan, aprobado sin cambios. Seis subfases (F4a–F4f), una por sesión, cada una cerrada con pruebas, commit, push, CI y `CONTEXTO.md` apuntando a la siguiente. Requisitos del usuario incorporados:
  - B no reutiliza código de A;
  - los puzzles de referencia se verifican con los dos solvers;
  - el corpus de 1000 puzzles va aparte y la CI corre una versión reducida;
  - el tiempo de generación se mide y se documenta.
- SPEC 1.2: R-35 «Motor del puzzle» con T-35.1 a T-35.6. Plan 1.06: tabla de subfases en F4.
- `packages/engine`:
  - `src/types.ts`: solo tipos; es lo único que comparten los dos solvers.
  - `src/model/`: `geometry`, `mask`, `structure` (`validateStructure`), `validate` (`validateSolution`, `checkPlacement`, `isEvidentMistake`) y `notes` (`cleanupPeers`, `clearCellNotes`).
  - Las validaciones devuelven listas de problemas con código. `cleanupPeers` no modifica la entrada y devuelve los candidatos quitados, que necesita el deshacer con comprobación (P7).
- Ayudas de prueba: cuadrículas válidas por patrón y transformaciones, comprobadas con el validador, sin cuadrículas recordadas; particiones aleatorias en jaulas (`killerArb`).
- Pruebas:
  - geometría y máscaras;
  - T-35.3 (estructura con un caso por cada código de problema, solución, `checkPlacement` e `isEvidentMistake` con un par que solo comparte la jaula);
  - T-17.1 (propiedad: solo cambian los pares y la celda, y `removed` es exactamente la diferencia).
  - El ejemplo `cell-index.test.ts` de F3 se reemplazó por `geometry.test.ts`.
- Lint:
  - `no-restricted-imports` para que `solver-b` solo importe `../types.ts` y `solver-a` no importe `solver-b`, con su test (T-35.1);
  - `no-non-null-assertion` desactivada en `packages/engine` (índices sobre arreglos tipados con `noUncheckedIndexedAccess`). Corregido después: solo en los solvers (ver la entrada siguiente).
  - `tests/lint-helpers.ts` se comparte entre los tests de lint.
- `docs/motor.md` creado (principios y modelo).

**Problemas y soluciones:**
- Un heredoc largo de Bash con varios archivos falló («unexpected EOF»). Los archivos largos se escriben con la herramienta de escritura, no con heredocs encadenados.
- Para la regla de aislamiento se usó `regex` en `no-restricted-imports` en lugar de patrones estilo gitignore, que no se llevan bien con rutas que empiezan con `../`.

**Tiempo real:** unos 0,3 h (15:52 a 16:12 aproximadamente), incluida la planificación de F4, en una sesión, sin contar la revisión del usuario.

**Siguiente:** F4b, solver A.

## 2026-10-22 — Corrección de F4a: alcance de la excepción a `no-non-null-assertion`

**Hecho (pedido del usuario):**
- La excepción a `no-non-null-assertion` ya no cubre todo `packages/engine`. Un override de ESLint la limita a `src/solver-a/**` y `src/solver-b/**` (`SOLVER_FILES`), y `tests/lint-non-null.test.ts` fija ese alcance.
- Modelo, validador, geometría, tests y ayudas de prueba sin `!`: `for...of`, `forEach` con índice, comprobaciones explícitas y la función `at(list, index)` (`src/model/at.ts`), que lanza `RangeError` si el índice no existe.
- Justificación en `docs/motor.md` («Aserción de no nulo»).

**Tiempo real:** unos 0,1 h (16:13 a 16:18 aproximadamente).

**Siguiente:** F4b, solver A.

## 2026-10-22 — F4b: solver A

**Hecho:**
- `packages/engine/src/solver-a/`:
  - `combos.ts`: tabla de combinaciones por (tamaño de jaula, suma), una vez por tamaño de tablero.
  - `context.ts`: unidades, pares con jaula, cruces caja-línea y grupos de suma: jaulas, más innies y outies de cada caja, par de cajas vecinas, bloque de 2 × 2 cajas y unión de filas o columnas consecutivas (regla del 45).
  - `propagate.ts`: singles con cola; filtro exacto de grupos (soporte por asignaciones completas de cada combinación, que incluye las cotas de suma); dígitos obligatorios de un grupo que apuntan a una unidad; cotas de suma para innies y outies grandes; hidden singles; locked candidates.
  - `solve.ts`: `solveA(puzzle, { limit = 2 })` → `{ count, solutions, nodes }`. Backtracking con dom/wdeg (MRV ponderado por fallos), determinista.
- Pruebas (T-35.1): fuerza bruta 4×4 independiente del motor (`test/helpers/brute-force.ts`) como oráculo en 300 puzzles aleatorios con sumas desplazadas y números iniciales erróneos; casos con 0, 1 y 2 o más soluciones; unicidad por números iniciales en 6×6 y 9×9; toda solución pasa `validateSolution`; determinismo; tabla de combinaciones contra una enumeración independiente hasta 16×16.
- `docs/motor.md`: API, algoritmo, pruebas y mediciones del solver A.

**Problemas y soluciones:**
- La primera versión (singles, hidden singles, filtro de jaulas y MRV) tardaba hasta 28 s en un 9×9 con jaulas grandes. Se agregaron innies y outies, locked candidates y dígitos obligatorios: la media bajó a 81 ms, pero quedó una cola de 57 s.
- Esa cola era *thrashing*: puzzles con muchas soluciones en los que MRV no encontraba ni la primera en 600 000 nodos. dom/wdeg la bajó a unos 500 nodos. Resultado con 1000 puzzles 9×9: media 7 ms, p99 49 ms, máximo 2,4 s.
- Se midieron y descartaron otros desempates del MRV y los grupos exactos de más de 5 celdas (detalle en `docs/motor.md`).

**Tiempo real:** unos 0,6 h (16:19 a 16:55 aproximadamente), en una sesión, sin contar la revisión del usuario.

**Siguiente:** F4c, solver B (Dancing Links).

## 2026-10-22 — F4c: solver B

**Pedido del usuario para esta subfase:** comparar A y B también en 6×6 y 9×9, incluir puzzles con varias soluciones (el `count` con `limit: 2` y el conjunto de soluciones cuando es pequeño), investigar cualquier discrepancia y anotar en el plan una condición para F4d.

**Hecho:**
- `packages/engine/src/solver-b/`, que solo importa `../types.ts`:
  - `matrix.ts`: comprobación de la entrada y cobertura exacta. Una opción por permutación de cada jaula que da su suma; ítems por celda y por (fila, columna o caja, dígito).
  - `dlx.ts`: Dancing Links sobre arreglos tipados (`cover`, `uncover`, `hide` y `unhide`).
  - `regions.ts`: regiones de la regla del 45 y suma parcial de cada opción en cada región.
  - `solve.ts`: `solveB(puzzle, { limit = 2 })` → `{ count, solutions, nodes }`, con la semántica de `solveA`. Algoritmo X con MRV y poda hasta un punto fijo con tres reglas propias: dos de subsunción entre ítems y jaulas y la regla del 45 por cotas.
- Pruebas: `solver-b.test.ts` (B contra la fuerza bruta y A en 4×4, casos fijos, entrada), `solvers-cross.test.ts` (A contra B en 6×6 y 9×9: cadenas de números iniciales con muchas, pocas y una solución, conjuntos completos cuando hay 12 o menos, variantes con 0 soluciones) y `reference.test.ts` con 13 puzzles de referencia (T-35.2). Las ayudas comunes de las pruebas de A pasaron a `test/helpers/puzzles.ts`.
- Mediciones en `docs/motor.md`: 1000 puzzles por tamaño, con 0 discrepancias de `count` entre A y B y la misma solución en los 189 únicos. B en 9×9: media 43 ms y máximo 3,8 s; en puzzles únicos, media 13 ms y máximo 0,7 s.
- `PLAN.md` (1.07): nota para F4d (presupuesto de `solveA` en el generador, descarte de candidatos y medición de cuántos se descartan) y desviación de los puzzles de referencia.

**Discrepancias entre A y B:** ninguna en ninguna medición: 3000 puzzles con `limit: 2`, 200 únicos, 300 cadenas 9×9 sin números iniciales de partida (1554 puzzles con `limit: 2` y 13, de los que 660 se compararon como conjuntos completos de 2 a 12 soluciones) y las pruebas repetidas con semillas al azar. Hubo dos fallos de prueba, y se investigaron:
- `shiftFirstSum` podía dejar una suma inalcanzable (por ejemplo, 17 + 1 en una jaula de 2 celdas), y A lanzaba `RangeError`. Era un error de la prueba: ahora desplaza hacia donde la suma sigue siendo alcanzable y salta las jaulas de suma fija.
- Una cadena 9×9 superó los 5 s de Vitest: era B, que es lento en algunos 9×9 sin números iniciales y con muchas soluciones.

**Problemas y soluciones:**
- El Dancing Links puro no escalaba en 9×9: hasta 59 s y 3 M de nodos en un puzzle con muchas soluciones, y 1,5 M de nodos para probar la unicidad de otro. La regla del 45 podando opciones, las cachés por profundidad y las reglas de subsunción bajaron el total de 11 puzzles difíciles de 261 s a 2,1 s.
- Se midieron y descartaron otra formulación (celda, dígito y combinaciones), dom/wdeg sobre los ítems y regiones de pares de cajas (detalle en `docs/motor.md`).
- Las pruebas 9×9 de la CI parten de 3 números iniciales para acotar el tiempo de B. Los 9×9 sin números iniciales se comparan en la medición y se compararán en el corpus de F4d.
- **Desviación (T-35.2):** no hay fuente pública legible por máquina para los puzzles de referencia, así que se construyeron. Su resultado lo calcularon A y B y lo confirmó el validador (ver `PLAN.md`, F4).

**Tiempo real:** unos 1,1 h (16:55 a 18:02 aproximadamente), en una sesión, sin contar la revisión del usuario.

**Siguiente:** F4d, generador.

## 2026-10-23 — Refuerzo de F4c antes de F4d

**Pedido del usuario:** una opción de `solveB` sin poda propia (Dancing Links puro) y la comparación con B con poda en 4×4, 6×6 y 9×9 con números iniciales (mismo `count` con `limit: 2` y mismo conjunto de soluciones; cualquier diferencia bloquea); que toda prueba aleatoria imprima su semilla al fallar, y que cada semilla que falle quede como caso fijo de regresión.

**Hecho:**
- `solveB(puzzle, { prune: false })`: sin las reglas 1 a 3 ni el descarte de opciones que repiten un número inicial de su fila, columna o caja (`buildExactCover(puzzle, blockPeers)`).
- `test/solver-b-pure.test.ts` (T-35.1): 4×4 con conjuntos completos, 6×6 sin números iniciales y 9×9 con 15, en cadenas hasta la unicidad y en variantes con 0 soluciones.
- Medición: 4307 puzzles, **0 diferencias** (tabla en `docs/motor.md`). Dancing Links puro en 9×9 es rápido desde unos 12 números iniciales (media 13 ms con `limit: 2`) y llega a 1,7 s con 5.
- `test/helpers/property.ts`: `assertProperty` reemplaza a `fc.assert` en todas las pruebas, que ahora lo prohíbe el lint (`tests/lint-property-seed.test.ts`). Imprime `{ seed, path }` al fallar, devuelve la semilla para las comprobaciones posteriores (`seedMessage`) y ejecuta antes las regresiones registradas. Su propio test: `test/property.test.ts`.
- La única comprobación posterior que había (`smallSets > 0` en `solvers-cross.test.ts`) ahora imprime la semilla.
- `docs/motor.md` explica el procedimiento de regresión; `PLAN.md` pasa a la 1.08.

**Problemas y soluciones:**
- ESLint no suma las opciones de `no-restricted-properties` entre bloques: las pruebas de los paquetes puros repiten las dos listas (reloj y azar, y `fc.assert`).

**Tiempo real:** unos 0,25 h (10:50 a 11:05 aproximadamente).

**Siguiente:** F4d, generador.

## 2026-10-23 — F4d: generador

**Pedido del usuario para esta subfase:** que el generador use `solveA` con un presupuesto (de nodos, agregado como opción de `solveA`), que descarte los candidatos que lo excedan y que se mida cuántos se descartan; verificar con `solveB` cada puzzle aceptado.

**Hecho:**
- `solveA(puzzle, { maxNodes })`: se detiene al agotar el presupuesto, con `exhausted: true` en el resultado. Pruebas: nunca pasa del presupuesto, lo encontrado es un prefijo de la búsqueda completa y, con presupuesto suficiente, el resultado es el mismo.
- `packages/engine/src/generator/`:
  - `rng.ts`: SFC32 sembrado con SplitMix32, `int` sin sesgo, `shuffle` y `weightedIndex`.
  - `grid.ts`: cuadrícula completa aleatoria.
  - `cages.ts`: partición en jaulas conectadas de 2 a 5 celdas sin dígitos repetidos y recorte de jaulas.
  - `generate.ts`: `generatePuzzle({ seed, ... })` → `{ puzzle, solution, givensReason, stats }`. Unicidad con A y presupuesto (1000 nodos por defecto), hasta 40 reajustes de jaulas donde difieren dos soluciones, números iniciales de unicidad si no alcanza, `easyGivens` y verificación final con B.
- Pruebas: `rng.test.ts`, `generator.test.ts` (T-20.1, T-20.2 y T-35.6 en 4×4, 6×6 y 9×9, descarte por presupuesto y opciones inválidas) y el corpus `generator.corpus.test.ts` (1000 puzzles 9×9), fuera de `pnpm test`: `pnpm test:corpus` y el workflow `.github/workflows/corpus.yml` (cada lunes con semillas nuevas, y manual).
- Mediciones en `docs/motor.md`.

**Resultados:** corpus de 1000 puzzles 9×9 con **0 discrepancias** entre A y B. Tiempo medio de generación: **39 ms** (mediana 36 ms, p99 103 ms, máximo 137 ms), con la verificación de B incluida (unos 15 ms). Con el presupuesto de 1000 nodos se descartó **1 de 1001 candidatos**; con 10 nodos, 28 %; sin límite, ninguno, pero un candidato tardó 437 ms. El 0,7 % de los puzzles necesita números iniciales para la unicidad.

**Problemas y soluciones:**
- Con 10 reajustes de jaulas, el 30 % de los puzzles necesitaba números iniciales; con 40, el 1,5 % (200 semillas). Se eligió 40.
- La prueba del descarte suponía que con `maxNodes: 1` no se acepta ningún puzzle, y falló: la propagación de A resuelve algunos puzzles generados en la raíz. Se rehízo sin esa suposición: si un puzzle se acepta en el candidato `c`, con `maxCandidates: c − 1` el generador tiene que fallar. Queda anotado para el calificador.
- Las expresiones de GitHub Actions no tienen aritmética: la primera semilla del corpus programado se calcula en un paso de shell.
- `mergeConfig` de Vitest suma las listas `include` y `exclude`: la configuración del corpus se arma aparte.

**Tiempo real:** unos 0,4 h (11:05 a 11:30 aproximadamente), en la misma sesión que el refuerzo de F4c.

**Siguiente:** F4e, calificador (niveles 1 a 3) y `levelToDeduce`.

## 2026-10-23 — F4e: calificador, niveles 1 a 3, y `levelToDeduce`

**Pedido del usuario para esta subfase:** técnicas aisladas que devuelven sus deducciones con su nivel, aplicando siempre el nivel más bajo; una prueba de propiedades sobre el corpus que compruebe que ninguna deducción contradice la solución (cualquier fallo bloquea la subfase); «excede las técnicas» en vez de adivinar; `levelToDeduce` determinista, solo con los dígitos colocados y con su tiempo medido en 9×9; dividir el trabajo en niveles 1 a 3 (esta subfase) y 4 y 5 (F4f), y reportar la distribución de niveles del corpus.

**Hecho:**
- `packages/engine/src/grader/`: contexto por puzzle (memoizado), estado de candidatos, filtro exacto de grupos con suma conocida y las técnicas `nakedSingle`, `hiddenSingle` y `cageLastCell` (nivel 1), `cageCombination` y `cageForcedDigit` (nivel 2) e `innieOutie` (nivel 3). `grade(puzzle, { trace })` y `levelToDeduce(cell, { puzzle, values })`, con `UNRATED = 6`.
- Pruebas: `test/grader.test.ts` en la CI (T-35.4 y T-35.5: reproducción de la traza con el orden de niveles comprobado, deducciones contra la solución desde estados al azar, 4×4 con cualquier número de soluciones contra la fuerza bruta, monotonía de `levelToDeduce`, oráculos independientes para las técnicas de jaula) y `test/grader.corpus.test.ts` en `pnpm test:corpus`.
- `docs/motor.md`: sección del calificador con API, técnicas, algoritmo, pruebas y mediciones.

**Resultados:** corpus de 1000 puzzles 9×9 (semillas 1 a 1000): **365 264 deducciones, 0 contra la solución**. Nivel máximo: 0 de nivel 1, 100 de nivel 2, 668 de nivel 3 y **232 que exceden las técnicas**. `grade`: media 11 ms. `levelToDeduce` en 100 partidas simuladas (8099 llamadas): **media 0,77 ms, p95 4,7 ms**, máximo 30 ms; desde el tablero vacío, unos 15 ms.

**Problemas y soluciones:**
- La primera versión enumeraba todas las asignaciones de cada jaula y grupo en cada pasada: `grade` tardaba 37 ms de media. Con una memoria por jaula y grupo (el resultado depende solo de sus máscaras), búsquedas dirigidas por (celda, dígito) y una poda por dígitos libres, unos 9 ms en la misma muestra; la distribución de niveles no cambió.
- Una prueba falló por la ayuda `shiftFirstSum`, que lanza si todas las jaulas 4×4 tienen 4 celdas; se corrigió la prueba y la semilla quedó como regresión.

**Tiempo real:** unos 0,4 h (11:55 a 12:15 aproximadamente).

**Siguiente:** F4f, calificador niveles 4 y 5, histograma preliminar y cierre de F4.

## 2026-10-23 — F4f: calificador, niveles 4 y 5, y cierre de F4

**Pedido del usuario para esta subfase:** los mismos requisitos de F4e (técnicas aisladas, prueba de corrección contra la solución en el corpus y nunca adivinar); volver a medir `levelToDeduce` con los niveles 4 y 5 (p95 en 9×9 por debajo de 50 ms; si no, optimizar o avisar); informar la distribución final del corpus por nivel máximo; registrar en F5 dos decisiones pendientes (excluir del banco los puzzles que exceden las técnicas, y el rendimiento bajo del nivel fácil); cerrar F4 con la suma de horas reales, la comparación con lo estimado y una recalibración propuesta de F5 a F13.

**Hecho:**
- Nivel 4: `lockedCandidates` (pointing y claiming, también a través de jaulas), `nakedPair` y `nakedTriple` (en unidades y jaulas), `hiddenPair` y `hiddenTriple` (en unidades, y en jaulas con sus dígitos obligatorios) y `cageUnitLock` (si un dígito de una unidad solo cabe en una jaula, la jaula tiene que usarlo). Nivel 5: `xWing`, `swordfish`, `yWing` y `unitCombination` (una unidad entera con todas las jaulas que la tocan). `MAX_TECHNIQUE_LEVEL` pasa a 5.
- `sumSupport` admite dígitos que la asignación tiene que usar (`mustUse`).
- Pruebas: `test/grader-advanced.test.ts` (T-35.4) con estados que todavía admiten la solución (dígitos correctos y candidatos equivocados quitados al azar): ninguna técnica la contradice en 4×4, 6×6 y 9×9, y cada técnica nueva coincide con un oráculo por fuerza bruta escrito aparte. Además, una prueba comprueba que cada técnica deduce algo en algún estado, para que la comparación no sea vacía. El corpus imprime los pasos por técnica.
- `docs/motor.md` y `docs/PLAN.md` (F4, F5, sección 5 y sección 8, versión 1.11).

**Resultados:** corpus de 1000 puzzles 9×9: **401 109 deducciones, 0 contra la solución**. Nivel máximo: 0 de nivel 1, 100 de nivel 2, 668 de nivel 3, 77 de nivel 4, 85 de nivel 5 y **70 que exceden todas las técnicas** (eran 232). `levelToDeduce` en 100 partidas simuladas (8099 llamadas): **media 1,5 ms y p95 9,2 ms**, máximo 85 ms. `grade`: media 25 ms y p95 59 ms. Monotonía de `levelToDeduce` comprobada aparte en 9000 comparaciones (200 puzzles), sin ninguna subida.

**Problemas y soluciones:**
- `unitCombination` con búsquedas dirigidas por (celda, dígito), como `sumSupport`, tardaba unos 12 ms por llamada, y una memoria de estados sin salida casi no ayudó. Se reescribió enumerando las formas de llenar cada jaula dentro de la unidad, agrupadas por conjunto de dígitos, y combinándolas con un barrido hacia adelante y hacia atrás sobre las máscaras: 2,4 veces más rápido y exacto.
- La primera medición del corpus corrió a la vez que las pruebas, así que se repitió sin otra carga. Los números de arriba son los de la segunda.
- Y-Wing y Swordfish no se usaron nunca en el corpus (X-Wing, una vez): antes deducen algo las técnicas de jaula y de unidad. Se dejaron porque son correctas, tienen su oráculo y son baratas.

**Cierre de F4:** F4a ~0,3 h (+0,1 de corrección), F4b ~0,6, F4c ~1,1, F4d ~0,4, F4e ~0,4 y F4f ~0,5: **unas 3,4 h frente a 20–35 h estimadas** (entre el 10 % y el 17 %). De F0 a F4, unas 4,8 h frente a 34–60 h. La recalibración propuesta de F5 a F13 (de 96–171 h a 28–57 h) está en `docs/PLAN.md`, sección 5, pendiente de aprobación.

**Tiempo real:** unos 0,5 h (13:09 a 13:40 aproximadamente).

**Siguiente:** F5, banco de puzzles y calibración de dificultad. Empieza por las decisiones pendientes a) y b) y por la aprobación de la recalibración.


## 2026-10-23 — Correcciones posteriores a F4f e informe para F5

**Pedido del usuario:** quitar de la bitácora las menciones de quién ejecutó cada sesión; confirmar el límite de 50 ms del p95 de `levelToDeduce`; versionar la monotonía de `levelToDeduce` con los niveles 4 y 5 (las 9000 comparaciones en el corpus y una versión reducida en la CI, con T-35.5); un informe para F5 sin cambiar el calificador (uso por técnica, peso de `unitCombination` en el nivel 5 y una variante acotada propuesta); registrar las decisiones aprobadas de F5 y la recalibración aprobada (F7 y F13 en 10 h), y alinear la frase de jugadas simultáneas del plan con R-05.

**Estado encontrado:** la sesión anterior se cortó sin dejar cambios en el repositorio (árbol limpio, sin stash), así que todos los puntos se hicieron desde el commit de F4f. El límite de 50 ms ya figuraba bien en todos los documentos, y ningún documento versionado decía que `unitCombination` estuviera fuera de una lista cerrada.

**Hecho:**
- Bitácora: se quitaron las menciones de quién ejecutó cada sesión (commit aparte).
- `test/helpers/grader.ts`: `expectMonotoneLevels` (T-35.5), que sigue celdas vacías desde los números iniciales mientras se agregan tandas de celdas correctas. En la CI (`grader.test.ts`): 4 puzzles 9×9 de nivel 4 y 5, 180 comparaciones. En el corpus: 200 puzzles, 9000 comparaciones, sin ninguna subida.
- `test/helpers/grader-report.ts` y el corpus: uso por técnica (puzzles, pasos y deducciones), `grade` sin `unitCombination` en los puzzles de nivel 5 y, para cada deducción de `unitCombination`, las jaulas y combinaciones de la unidad más chica que la justifica. El calificador no cambió.
- `docs/motor.md`: informe para F5 y propuesta de una variante acotada de `unitCombination` (como mucho 4 jaulas abiertas y 8 combinaciones), sin implementar.
- `docs/PLAN.md` (1.11): recalibración aprobada en la sección 5 y en los encabezados de F5 a F13 (F5 a F13, 40–61 h; total de la v1, unas 45–66 h), decisiones a), b) y c) de F5 y la sección 1 alineada con R-05.

**Resultados:** `unitCombination` se usa en los 85 puzzles de nivel 5 y, sin ella, los 85 exceden las técnicas. Por deducción: 5 jaulas abiertas de mediana (p95 6, máximo 8) y 7 combinaciones de mediana (p95 52, máximo 825). Con la cota propuesta entra el 36,9 % de las deducciones. Solo 1 puzzle de nivel 5 tiene todas sus deducciones dentro, pero es una cota inferior: lo que conservaría la variante se mide en F5. Y-Wing y Swordfish siguen sin usarse.

**Problemas y soluciones:**
- El corpus imprimía pasos por técnica, pero no deducciones ni puzzles. Se reproduce la traza de `grade` con un estado propio para contarlos y para analizar cada unidad sin tocar el calificador.
- `gradeWithout` repite el bucle de `grade`. Para comprobar que la réplica es fiel, en los puzzles de nivel 5 que no usan `unitCombination` se exige el mismo resultado que `grade` (no hubo ninguno: los 85 la usan).

**Tiempo real:** unos 0,4 h (18:45 a 19:10 aproximadamente).

**Siguiente:** F5, con las decisiones aprobadas. Empieza por el script de lotes y por la equivalencia entre niveles y dificultades, que se decide con el informe (incluida la medición real de la variante acotada si se adopta).


## 2026-10-23 — F7: diseño visual propio (cierre)

**Pedido del usuario:** cerrar F7 importando el diseño final, hecho fuera del repositorio, sin implementarlo en `apps/web` (eso es F8): descartar el worktree y la rama de direcciones anteriores, importar el prototipo con fuentes locales, documentar la guía de estilo, las pantallas, la entrega a F8 y el registro de fotos, y dejar escritas siete correcciones al prototipo para aplicar en F8.

**Hecho:**
- Limpieza: la rama `f7-diseno` nunca se subió al remoto. Se quitaron su worktree (`C:\dev\sudoku-killer-f7`) y la rama, sin merge; sus direcciones visuales estaban descartadas.
- `design/prototipo/`: las **4 páginas** (Sistema base: 6 artboards; Partida: 4; Pantallas: 22; Estados transversales: 19), **51 artboards** en total, con sus hojas de estilo (`tokens.css`, `ui.css`, `board.css`, `game.css` y `screens.css`) y el índice del lienzo (`canvas.json`). Las fuentes son woff2 locales con su licencia OFL (Inter y Newsreader; también IBM Plex Sans, que la hoja de tipografía muestra como reserva), sin fuentes incrustadas. Un motor mínimo propio (`support.js`) monta las plantillas, y un índice (`index.html`) abre cada artboard en un marco de su tamaño (`marco.html`). Se abre con `npx serve design/prototipo`. Tamaño total: 728 708 bytes (unos 712 KiB, 70 archivos), de los que 444 272 son fuentes y licencias.
- `docs/diseno.md`: guía de estilo y «Revisión de originalidad (T-18.1)». `design/pantallas.md`: pantallas y flujos. `design/entrega-f8.md`: decisiones, prioridades para F8, pendientes y lista de comprobación. `design/fotos.md`: las fotos son marcadores, con plantilla de fuente y licencia.
- Decisiones registradas para F8: Ajustes solo dentro de una sala; aviso de traspaso solo si quien sale tiene el derecho de iniciar; «Volver a la sala» según el estado de la sala; avisos breves de 6 s con pausa (aceptados frente a WCAG 2.2.1); deshacer «Borrar notas» agrupando `note.undo` en el cliente; el anillo de mismo dígito se prueba en un celular; variante B descartada e IBM Plex Sans de reserva.
- ESLint y Prettier ignoran `design/prototipo/` (se conserva como se diseñó) y lint-staged pasa `--no-warn-ignored` a ESLint para no fallar con archivos ignorados.

**Verificación:** los 51 artboards se renderizaron en un navegador servidos con `npx serve`, sin errores de carga. Se probaron interacciones: selección de celdas, Ajustes, diálogo de pista con foco en «Cancelar», filtrado del código de sala, opciones de dificultad y diálogo de salida, sin excepciones. Búsqueda de menciones de herramientas sobre `design/` y `docs/diseno.md`: 0 resultados.

**Problemas y soluciones:**
- Los artboards son plantillas con lógica, no HTML estático. El analizador del navegador reordena las plantillas dentro de tablas, así que el motor lee cada archivo con `fetch` y lo analiza aparte; por eso hace falta un servidor estático.
- `npx serve` redirige `marco.html` a `/marco` y descarta la consulta: los parámetros del marco van en el fragmento.
- Dentro de la partida y del lobby, el foco inicial de Ajustes termina en «Cerrar» y no en el interruptor (el diálogo contenedor lo mueve). Queda como pendiente para F8; el prototipo no se cambió.

**Tiempo real de F7:** unas 1,5 h, frente a las 10 h aprobadas.

**Siguiente:** F5, banco de puzzles y calibración de dificultad, empezando en modo plan.

## 2026-10-23 — F5: banco de puzzles y calibración de dificultad

**Pedido del usuario:**
- Plan con cuatro subtareas: acotar `unitCombination` y medir las cotas 4/8, 5/16 y 5/32; equivalencia entre niveles y dificultades con histogramas; script de lotes; esquema `puzzles` y manifiesto de semillas; `docs/dificultad.md`; y cómo tratar la prueba manual sin cliente.
- Al aprobar el plan agregó la prueba T-20.5, la justificación correcta del `id` opaco, español neutro en los documentos y un punto de control después de medir las cotas.
- En el punto de control aprobó la cota 4/8 y la equivalencia, como versión 1 sujeta a recalibración.

**Hecho:**
- **F5a:**
  - `unitCombinationWithin({ maxOpenCages, maxCombinations })`: la técnica solo mira unidades dentro de la cota, cuenta las combinaciones en la pasada hacia adelante y no hace la pasada hacia atrás si se pasa.
  - `TECHNIQUES` usa 4/8 y `GRADER_VERSION` pasa a "2". `grade` acepta `techniques` para medir.
  - Pruebas: un oráculo con cota (6 cotas, en 4×4 y 6×6), en el que el oráculo de permutaciones cuenta las jaulas abiertas y las combinaciones por su cuenta, y `grader-bounds.corpus.test.ts`.
- **F5b:**
  - `difficultyOf` (equivalencia versión 1), y `Difficulty` y `PublicPuzzle` en el protocolo.
  - `buildBank` y `bank:generate`, que recorren semillas en orden, descartan las que exceden y se quedan con las primeras 500 de cada dificultad.
  - Manifiesto en `apps/server/bank/manifest.json` y `docs/dificultad.md`.
- **F5c:**
  - Drizzle (tabla `puzzles` con su migración y restricciones), `PuzzleRepository` (`getForServer` y `getPublic`) y `loadBank`, que verifica cada semilla antes de escribir y es idempotente.
  - Pruebas con PGlite. SPEC 1.3 (T-20.3 a T-20.5) y ADR 0006; nota en el ADR 0003.
- **F5d:** `bank:sample` genera `design/muestra-f5/muestra.html`, con 12 puzzles en SVG, en orden al azar y con letras, más la clave y las soluciones.

**Resultados:**
- **Cotas** (corpus 1 a 1000, de 85 puzzles de nivel 5):

  | Cota | Conserva | Pasan a exceder | Minutos para 500 de nivel 5 |
  |---|---|---|---|
  | 4/8 | 39 | 46 | 9,9 |
  | 5/16 | 75 | 10 | 5,2 |
  | 5/32 | 77 | 8 | 5,1 |

  La cota inferior del informe de F4f era 1 para 4/8: la técnica acotada encuentra otros caminos. Los niveles 2 a 4 conservan nivel y pasos con cualquier cota.
- **Corpus con 4/8:**
  - 391 229 deducciones, 0 contra la solución, y monotonía en 9000 comparaciones sin ninguna subida.
  - `grade`: media de 15,6 ms. `levelToDeduce`: media de 0,91 ms y p95 de 5,5 ms.
- **Banco:**
  - 15 254 semillas en 9,2 minutos (36,2 ms por candidato); 1589 excluidas (10,4 %).
  - Semillas hasta completar 500: fácil 4661, media 1048, difícil 1793 y experto 15 254.
  - El experto sale en el 3,3 % de las semillas.
- **T-20.5:** en partidas simuladas sobre el banco, `levelToDeduce` nunca devuelve `UNRATED`: en la muestra de la CI y en los 2000 puzzles del corpus.

**Problemas y soluciones:**
- La prueba de la CI falló por tiempo en algunas pruebas lentas mientras corría el corpus a la vez: era la carga de la máquina. Corridas por separado, todo en verde. Las mediciones de las cotas se repitieron sin otra carga.
- pnpm 12 rechaza la instalación cuando una dependencia trae un script de instalación no aprobado (esbuild, que usa drizzle-kit). Su binario llega como dependencia opcional, así que en `pnpm-workspace.yaml` se marcó `allowBuilds: esbuild: false`.
- drizzle-kit carga el esquema sin las fuentes del monorepo: el esquema solo importa tipos, y una prueba comprueba que su lista de dificultades coincide con la del protocolo.
- Las versiones de las dependencias nuevas se fijaron entre las publicadas hace al menos dos semanas: drizzle-orm 0.45.4, drizzle-kit 0.31.11 y PGlite 0.5.8.

**Desviación registrada:** la prueba manual con jugadores se hace en papel con la muestra imprimible, y sus resultados van a `docs/dificultad.md`, sección 6. La prueba con varios jugadores en tiempo real queda para F8 y F13.

**Tiempo real de F5:** unas 1,2 h, frente a las 2–4 h aprobadas. La comparación está en el PLAN, sección 5: la recalibración se mantiene.

**Siguiente:** F6, sistema de puntuación, empezando en modo plan.

## 2026-10-23 — F5: números iniciales por dificultad

**Pedido del usuario:**
- Tras la prueba en papel con la primera muestra, escalonar los números iniciales por dificultad, en reemplazo de la decisión b). Los objetivos eran unos 30, 22, 10 y 0.
- Medir antes de regenerar nada, con un punto de control.
- Después aprobó: 30 / 22 / 10 / 0, con bandas que no se solapan (fácil, nivel 1; media, nivel 2; difícil, nivel 3 o 4 con algún paso de nivel 3; experto, nivel 5); celdas con guarda, repartidas por cajas y con semilla; semillas separadas por dificultad; `GENERATOR_VERSION` "2"; y la confirmación de la unicidad también con A.
- Pidió detenerse si alguna tasa bajaba del 50 % o si el banco tardaba más de 30 minutos. No pasó ninguna de las dos cosas.

**Resultado de la prueba en papel:** sin números iniciales, los puzzles resultan difíciles, incluido el fácil.

**Medición previa:**
- Se probaron tres cantidades por dificultad y tres formas de elegir las celdas: al azar, repartidas por cajas y con guarda (repartidas por cajas y agregadas solo si el puzzle mantiene el piso de su banda).
- Sin guarda, los números bajan el nivel demasiado rápido:
  - con 10 números, el 99 % de los puzzles queda en nivel 2, y el difícil sale en el 0,8 % (al azar) o el 0,5 % (por cajas), 31 o 50 minutos para 500;
  - con 22 números, el 69 % se resuelve solo con singles.
- Con guarda, las cantidades pedidas salen en el 87 % al 100 % de los candidatos, en menos de 2 minutos por dificultad.
- La unicidad se comprobó con A en 920 puzzles con números iniciales.

**Hecho:**
- **Motor:**
  - `addGivens(generated, { count, seed, keep })`, en `src/generator/givens.ts`: recorre las celdas por vueltas entre las cajas, saltea las que no cumplen la guarda y confirma la unicidad con A y con B.
  - Reemplaza a la opción `easyGivens` de `generatePuzzle`. `givensReason` pasa a `'none' | 'difficulty' | 'uniqueness'` y `GENERATOR_VERSION` pasa a "2".
  - Pruebas: T-20.2, reparto entre cajas, guarda, determinismo (T-35.6) y opciones inválidas. Las pruebas del calificador que usaban `easyGivens` ahora usan `addGivens` sin guarda.
- **Servidor:**
  - `DIFFICULTY_RULES` (equivalencia versión 2) con cantidad, piso y banda de cada dificultad; `difficultyOfSeed` (resto al dividir por 4).
  - `evaluateSeed` y `buildBank` saltan las semillas de las dificultades ya completas, y el manifiesto guarda los números iniciales de cada dificultad.
  - Migración del `CHECK` de `givens_reason`.
  - Pruebas de las bandas (que no se solapan) y del manifiesto.
- **Banco nuevo:**
  - semillas 1 a 62 079, 17 090 candidatos en 13,1 minutos;
  - tasas: fácil 99,0 %, media 100 %, difícil 88,5 % y experto 3,2 %;
  - pasos (mediana): 14, 13, 25 y 71.
- **Documentación y muestra:**
  - SPEC 1.4 (P2, §2.2, T-20.2 y T-20.3);
  - `docs/dificultad.md`, con la versión 2, la medición y la versión 1 como historia; `docs/motor.md` y ADR 0006;
  - muestra nueva con la semilla 2026.

**Observación para la segunda prueba en papel:** la guarda deja el mínimo de técnica que pide la banda. Todas las medias necesitan un solo paso de nivel 2 (una necesita dos) y todas las difíciles, uno solo de nivel 3. Fácil y media tienen casi los mismos pasos: las distingue la técnica.

**Problemas y soluciones:**
- La generación del banco lanzada en segundo plano desde una subshell terminó junto con el comando que la lanzó, sin escribir nada. Se volvió a lanzar como tarea de fondo.
- Dos pruebas de carga con PGlite pasaron del límite de 5 s, porque ahora cada semilla regenera sus números con la guarda. Se les dio el mismo margen que a las otras pruebas lentas.

**Tiempo real:** unas 0,8 h. F5 suma unas 2,0 h, frente a las 2–4 h aprobadas.

**Siguiente:** la segunda prueba en papel (pendiente del usuario) y F6, sistema de puntuación, en modo plan.

## 2026-10-24 — F6: sistema de puntuación

**Pedido del usuario al planificar:**
- modelo puro en `packages/scoring`, con las firmas de `GameMode`;
- simulación Monte Carlo de 10 000 partidas como mínimo, con bots lógico, veloz y adivinador, pistas y R-05;
- una métrica de aporte real independiente de la fórmula;
- las métricas objetivo y la estimación del tiempo de la simulación;
- un punto de control antes de calibrar.

Al aprobar, agregó el nivel con los descartes públicos de los errores, las vidas en el simulador, la robustez frente a T(L) y no forzar la calibración si P o H quedaban desproporcionados.

**Hecho:**
- **F6a, motor:**
  - `BoardState.excluded` (descartes públicos) y `levelsToDeduce`, que da el nivel de todas las celdas y los puntos fijos por nivel en una pasada.
  - Pruebas T-35.7 y T-35.8. `GRADER_VERSION` no cambia.
- **F6b, `packages/scoring`:**
  - `params.v1.json` con esquema Zod, `createScoring` (`onCorrect`, `onMistake` y `onHint`), `scoreLog` y `rankPlayers`.
  - 16 pruebas: T-02.1 a T-02.3, T-19.5, T-32.4 y T-36.1 a T-36.5, esta última de tipos.
- **F6c, simulador** (`apps/server/scripts/scoring-sim/`):
  - eventos discretos en tiempo virtual, con bots, vidas y derrota, R-05 con tiempo de reacción y pistas compartidas;
  - el bloque de pistas tiene ramas con pista, sin pista y placebo;
  - el aporte contrafáctico se mide con réplicas, y hay un modelo de comparación por velocidad;
  - hilos de trabajo, con el mismo resultado en cualquier cantidad de hilos.
- **Punto de control** (parámetros iniciales, semilla 1):
  - el veloz ganaba el 62,8 % de los duelos, pero su aporte solo superaba al del lógico en el 49,2 %;
  - bajar al 55 % exigía P ≈ 370;
  - el Spearman por estrato estaba limitado por la confiabilidad del aporte.
  - El usuario cambió las metas: equidad entre cuotas de puntaje y de aporte, entre veloz y lógico; Spearman contra el techo de confiabilidad; EV de adivinar frente a deducir.
- **F6d:**
  - Grilla de 81 combinaciones (`scoring:calibrate`): ninguna cumplió la equidad, y la más cercana quedó en 10,2 puntos.
  - El usuario eligió w = 1/2/3/4/5, β = 1, H = 60 y P = 90.
  - Validación con la semilla 2, 8 réplicas y tres perfiles de T(L): se cumplen las metas exigidas. El adivinador de nivel 3 tiene media negativa frente a deducir (−2,4), pero su intervalo toca el 0; el usuario decidió exigir la media.
- **F6e:** `docs/puntuacion.md`, SPEC 1.5, `docs/motor.md`, la prueba del corpus, PLAN 1.15 y CONTEXTO.md.

**Problemas y soluciones:**
- **Expertos ausentes en las corridas parciales:** el manifiesto está en orden de semilla y los expertos llegan mucho más tarde. Los puzzles se intercalan por dificultad.
- **Submuestra de robustez:** al intercalar, quedó solo con fáciles; ahora se toma por bloques de 4.
- **Ningún robo en la primera prueba:** exigir nivel ≥ 3 en la celda de la víctima era demasiado. Se bajó a ≥ 2, y la pista normal va a la celda más difícil del tablero.
- **Comparar adivinar contra esperar trababa las mesas** de solo adivinadores. La alternativa pasó a ser deducir fuera de su alcance.
- **Ramas con pista que daban más puntos:** era la desviación de la partida, como mostró el placebo (el 30 % de sus ramas da más). La meta se mide en media frente al placebo.
- **Prueba del corpus con 1000 partidas:** el nivel 3 dio +5,7 por ruido. La prueba repite la validación con una semilla fija.
- **Condición analítica:** la primera versión usaba w(1) después del error; la correcta usa w(s), el nivel del adivinador.

**Tiempo real:** unas 2,2 h, frente a 2–5 h. Las simulaciones largas (de 7 a 14 minutos cada una) corrieron en paralelo con el resto del trabajo.

**Siguiente:** F8, cliente con servidor local simulado, en modo plan. Sigue pendiente del usuario la segunda prueba en papel de F5.

## 2026-10-24 — Limpieza de atribuciones (antes de F8)

**Hecho:**
- Inventario de los archivos versionados: 27 coincidencias en 7 archivos, más un nombre de archivo. No había ninguna en el prototipo, el lockfile, los workflows ni los `package.json`.
- La memoria del proyecto pasa a `CONTEXTO.md` y se actualizan sus referencias (también en las entradas anteriores de esta bitácora). El archivo de carga local, no versionado, solo importa `CONTEXTO.md`; se excluye con `.git/info/exclude` y no con `.gitignore`.
- Redacción neutra: PLAN §4 pasa a «Protocolo de trabajo»; la línea de entorno verificado, las horas de §5, la tarea de verificación de F0, ADR 0001 y la entrada de F0 de esta bitácora ya no nombran herramientas. «Antes de cada /clear» pasa a «Antes de cerrar cada sesión o reiniciar el contexto». PLAN 1.16.
- `scripts/attribution-patterns.mjs`: los términos, codificados en base64, y las expresiones del hook. `strip-attribution.mjs` los toma de ahí.
- `scripts/attribution-guard.mjs` y el job `attribution-guard` de la CI: revisan el contenido y el nombre de los archivos versionados y los mensajes de los commits del push (`before..after`; si `before` es todo ceros o no existe, los commits que no están en otra rama remota) o del PR (`base..head`). El job empieza con un caso de control que tiene que fallar.
- `tests/attribution.test.ts`: el hook y el guardia, con fixtures codificados. El caso de control tiene dos commits y solo el primero contiene el término; el guardia falla con el rango del PR, con el del push y con `before` en ceros.

**Problemas y soluciones:**
- El job podía fallar con el propio push de la limpieza si un mensaje nombraba el archivo anterior. Los mensajes de estos commits lo evitan.
- Un push forzado deja un `before` que la CI no tiene. En ese caso, el guardia trata el push como una rama nueva.

**Tiempo real:** menos de 1 h.

**Siguiente:** auditoría del historial (paso 8) y decisión del usuario. Después, F8 en modo plan.

## 2026-10-24 — Historial reescrito y repositorio recreado

**Hecho:**
- Revisión de secretos en todo el historial y en el árbol (claves y tokens, cadenas de conexión, archivos de entorno, claves privadas, capturas de red y configuraciones locales): ningún secreto real. Los 19 hallazgos eran falsos positivos, la propiedad `pass` de las metas del simulador de puntuación.
- Respaldo local completo del repositorio anterior, fuera de las carpetas sincronizadas, que se conserva hasta nueva orden.
- Historial reescrito en un clon nuevo con reglas neutras para los mensajes y los contenidos, sin cambiar el sentido de las frases. Mismos 38 commits, mismos autores y fechas, y el árbol final es idéntico al anterior.
- Verificaciones sobre el historial completo (mensajes, contenidos, rutas, autores y correos): 0 coincidencias. Instalación, `check`, `test` y `build` en verde sobre el clon.
- Repositorio remoto recreado vacío, con la misma URL, y historial subido sin credenciales en la URL. La CI (`check` y `attribution-guard`) quedó en verde y `Corpus` figura como workflow programado.
- Seguridad del repositorio nuevo: secret scanning y push protection activos; alertas de Dependabot y actualizaciones de seguridad de Dependabot desactivadas (sin cambios, pendiente de decisión).
- El repositorio de trabajo apunta al historial nuevo, con el árbol limpio.

**Problemas y soluciones:**
- La primera corrida de la reescritura falló por una regla con un escape no válido en el reemplazo, y la segunda dejó una frase de PLAN sin regla. Se corrigieron las reglas y se repitió todo en un clon nuevo.
- Las versiones intermedias de `scripts/strip-attribution.mjs` quedaron con marcadores neutros en lugar de los patrones; la versión final no cambió.
- Se perdieron las ejecuciones anteriores de Actions al recrear el repositorio.

**Tiempo real:** menos de 1 h.

**Siguiente:** F8 en modo plan.

## 2026-10-24 — Alertas de seguridad de dependencias

- Se activaron las alertas de vulnerabilidades de dependencias del repositorio recreado. Las actualizaciones automáticas de seguridad siguen desactivadas, por decisión del usuario.
- Estado final: alertas de vulnerabilidades activas, actualizaciones automáticas de seguridad desactivadas, secret scanning y push protection activos.
- Se borró el clon temporal de la reescritura. El respaldo del repositorio anterior se conserva.

## 2026-10-24 — F8: cliente con servidor local simulado

**Pedido del usuario al planificar:**
- el reductor y el modo Normal definitivos, para que F9 los reutilice;
- el protocolo v1 completo;
- un `Transport` con servidor simulado que solo exista en desarrollo, verificado sobre el build;
- la pantalla de partida del diseño (prioridades 1 y 2), jugable en PC y en celular;
- un punto de control antes del bot y otro antes del cierre.

Al aprobar, agregó:
- push y CI en verde en cada subtarea;
- una lista cerrada de módulos para el cliente de producción;
- el hash del navegador igual al de `node:crypto`;
- `pnpm dev:lan` solo para la red de casa;
- el manifiesto solo en desarrollo;
- la prioridad 3 y los pendientes de la entrega de F7, a F10.

**Hecho:**
- **F8a, protocolo:** los mensajes de §4.2 y §4.3 como uniones discriminadas con payloads estrictos, el snapshot y los códigos de error. Pruebas de esquema por mensaje, más T-07.1 (parte de esquema), T-10.2, T-16.1, T-25.6 y T-34.1, adelantadas a F8.
- **F8b, `packages/bank` y `packages/game`:**
  - `packages/bank` es un paquete nuevo con lo puro del banco: dificultad, `regenerateSeed` y `canonicalPuzzle`. El servidor conserva el hash y la carga.
  - `packages/game` tiene `decide`, `apply`, `replay`, `project` y `createNormalMode`. El acierto guarda `level` y `graderVersion`.
  - Propiedades: T-15.1 y la base de T-32.1 (en vivo igual a `replay`, y puntajes iguales a `scoreLog`). Unitarias de las reglas, cada una con su T.
- **F8c, transporte y simulador:**
  - Servidor simulado en memoria con los mismos esquemas y el mismo reductor, con latencia y desfase configurables.
  - El puzzle se regenera desde el manifiesto y se comprueba contra su entrada.
  - Núcleo del cliente con store propio.
  - `check-dist` (T-31.2) revisa los módulos y el texto del build, con un fixture de control que lo hace fallar.
  - Una partida completa automatizada llega a la victoria.
- **F8d, interfaz:** tokens, fuentes locales, tablero con foco itinerante, las cuatro disposiciones, atajos, Ajustes y los estados de la prioridad 2. Pruebas de componentes: T-04.3, T-06.1, T-07.2, T-24.3, T-25.2, T-28.2 y T-33.1.
- **Punto de control (PC y celular), siete correcciones:**
  - los controles de capa a 320 px;
  - los botones de visibilidad en PC;
  - «Usar notas» como preferencia local (T-06.3);
  - la actividad en una línea con «Ver actividad»;
  - jaulas más gruesas;
  - el dígito pendiente en el mismo ciclo del evento, con una prueba a 120 ms de latencia;
  - capturas a 320, 360, 768, 1280, 1920 y 740 × 360.
  - Además, el tiempo de carga del puzzle se muestra en pantalla en desarrollo.
- **F8f, bot compañero:** entra por el protocolo y deduce con lo público, sin ver la solución. Usa una semilla, un ritmo y una tasa de errores a propósito, y deja de jugar sin vidas.
- **Prueba con el bot y correcciones:**
  - la red local, arreglada (abajo);
  - el aviso con «Reintentar» si el arranque falla o tarda más de 15 s (R-37, T-37.1);
  - jaulas de 2 px y de 3 px la seleccionada;
  - el enlace al repositorio en el Inicio;
  - una prueba de humo en WebKit por la IP de la red local, con el tamaño de un iPhone y de un iPad en vertical y en horizontal: sin solapamientos ni desplazamiento horizontal.
- **Cierre:** PLAN 1.18, SPEC 1.6, notas en los ADR 0001 y 0004, `docs/diseno.md` (repaso de originalidad incluido), entrega de F7 con la lista de comprobación marcada, tema oscuro en ideas futuras y CONTEXTO.md.

**Problemas y soluciones:**
- **El calificador llegaba al build del cliente** por los imports del motor. Se agregó el punto de entrada `./model` del motor, que solo reexporta, y se corrigieron los imports, no el detector. Es la desviación registrada; el corpus siguió en verde.
- **En las pruebas, el modo de desarrollo seguía activo y el build fallaba por el alias del manifiesto.** La prueba fuerza el modo de producción y comprueba que un build de desarrollo falla.
- **Grosores fraccionarios:** Chromium redondea hacia abajo el ancho de los bordes. Las jaulas de 1,5 px se veían de 1 px, y 2,5 px habría igualado a la jaula seleccionada con las demás. Los dos grosores pasaron a ser enteros.
- **«Entrando…» para siempre por la IP de la red local:** la página no es un contexto seguro, y el navegador no expone `crypto.randomUUID` ni `crypto.subtle`. Los identificadores pasaron a `crypto.getRandomValues`. El simulador usa un SHA-256 en JavaScript, solo en desarrollo y comprobado contra `node:crypto`, y `check-dist` rechaza sus constantes en el build.
- **T-31.3 superaba el tiempo límite** con toda la suite en paralelo. Arma un programa de TypeScript: 1,4 s sola. Se le dio un tiempo límite propio, sin cambiar lo que revisa.

**Tiempo real:** unas 3,4 h, frente a 4–8 h (el plan de F8 estimaba 6–10 h). No incluye las pruebas del usuario en PC, celular y tablet.

**Siguiente:** F9 en modo plan. Antes, la segunda prueba en papel de F5, que sigue pendiente del usuario.

## 2026-10-24 — F9: Servidor de salas

**Hecho:**
- **Plan aprobado con ajustes del usuario:**
  - PostgreSQL 18 local con un rol propio sin privilegios;
  - la ruta `apps/server/.env`;
  - el SQL en «SQL Shell (psql)»;
  - la nota del proxy de `/ws` para F10;
  - la revisión de las migraciones automáticas en F12;
  - el retiro de puzzles en vez de borrarlos.
- **F9a, piezas puras:** el apodo (en grafemas, D2) y la forma del código en `packages/protocol`; el código de sala, los asientos, el traspaso y el snapshot del lobby en `packages/game`; el esquema Zod del registro y `pickPuzzle` en `packages/bank`. El simulador de F8 y el Inicio dejaron sus copias.
- **F9b, núcleo:**
  - las interfaces de §8.2, con un transporte en memoria;
  - `RoomStore` y un actor por sala con su cola y una bandeja de salida ordenada;
  - el lobby, el ciclo de vida, las fichas de 128 bits (solo su SHA-256), los plazos, la purga, el borrado y E-08;
  - errores sin detalles internos y un log que tapa fichas y URLs de la base;
  - el inspector de filtración siempre activo, con una prueba de control por regla.
- **F9c, partida en vivo:** la presencia agrupada, la idempotencia con LRU, los límites de velocidad y las pruebas I de cada T-xx. T-32.1 contra el servidor real, con una comprobación de que la propiedad detecta un evento faltante.
- **Punto de control:** el usuario aprobó el esquema de `matches` y `match_events` y los cambios en `puzzles`.
- **F9d, persistencia:**
  - la migración `0002_matches` con el trigger de solo agregar;
  - el repositorio con Drizzle, que valida cada evento al leerlo;
  - el group commit con la confirmación antes de difundir;
  - la reconstrucción al arrancar (T-32.2, T-07.3, E-15);
  - E-16, con reintentos, rechazo de comandos y reconstrucción a los 10 s;
  - E-07 después de un reinicio;
  - el retiro de puzzles con su prueba.
  - Las pruebas I pasaron a correr sobre PGlite.
- **Base local:**
  - `db:setup-local` generó la contraseña del rol y creó el rol y la base; el usuario escribió la contraseña de `postgres` en la ventana de psql;
  - `listen_addresses` pasó a `'localhost'`, con una copia de `postgresql.conf` y el servicio reiniciado con permiso de administrador;
  - verificado: conexión sin mostrar la URL y el puerto 5432 solo en 127.0.0.1 y ::1;
  - `bank:load` dejó 500 puzzles vigentes por dificultad.
- **F9e, producción:**
  - el adaptador `ws` (orígenes permitidos, 16 KiB, heartbeat);
  - la configuración desde el entorno con Zod y `.env.example`;
  - `pg`, `db:migrate` y `bank:load`;
  - el apagado ordenado;
  - pruebas con conexiones `ws` reales y E-17.
  - El servidor compilado reconstruyó una partida después de un corte forzado.
- **F9f, cierre:**
  - la demostración `demo`: dos clientes Node por `ws` juegan hasta la victoria contra la base local y contra PGlite, con una nota, un error y una pista, y validan cada mensaje;
  - SPEC 1.7, PLAN 1.19 y las notas de F9 en los ADR 0002, 0003, 0004 y 0006.

**Problemas y soluciones:**
- **Pruebas de lint por tiempo:** con la CPU ocupada por las pruebas nuevas, el primer caso de cada archivo de lint pasaba los 5 s. La causa era la carga de la configuración y los plugins de ESLint (unos 1,8 s en reposo). Pasó a un `beforeAll` con su propio plazo, sin subir el límite de ningún caso.
- **Un índice único que habría ocultado cambios del banco:** `(generator_version, seed)` era único, y con una equivalencia nueva la misma semilla da otro puzzle. La identidad pasó al `hash` del manifiesto.
- **Esperas infinitas en las pruebas de E-16:** con la base caída, la bandeja de la sala espera una confirmación que no llega. La espera de las pruebas también termina cuando el destino de los eventos queda sin poder confirmar.
- **La demostración no terminaba:** los plazos de 120 s de las salas seguían programados después del apagado. El apagado ordenado ahora detiene las salas y cancela sus plazos antes de escribir lo pendiente.
- **La contraseña del rol nunca podía pasar por un comando:** psql recibe solo el verificador SCRAM-SHA-256, calculado con `node:crypto`. La contraseña queda únicamente en `apps/server/.env`.

**Tiempo real:** unas 1,9 h, frente a 3–6 h (el plan aprobado estimaba 6–7 h). No incluye la revisión del usuario ni el tiempo de las ventanas de configuración de la base.

**Siguiente:** F10 en modo plan. Antes, la segunda prueba en papel de F5, que sigue pendiente del usuario.

## 2026-10-25 — F10: de F10a a F10g, antes del punto de control

**Hecho:**
- **F10a a F10d** (2026-10-24): registros previos, transporte `ws` con reconexión y bandeja de pendientes, notas optimistas con T-16.2, proxy de `/ws`, `dev:lan` y bots Node.
- **Corrección de T-32.1:** la propiedad fallaba con «No room» (semilla -1802840427). El servidor estaba bien: el arnés elegía al «jugador 3» con `who % 3`, que era el 0, así que se caían todos y la sala se borraba a los 120 s, como pide R-14. Primero se excluyó al jugador 0; después se recuperó la cobertura: cada comando elige su actor entre los conectados, el 0 vuelve a poder salir, caerse y volver, y si no queda nadie y pasan 120 s la propiedad comprueba el borrado (`room.not_found`, registro en derrota) y termina esa ejecución. La regresión guarda `seed` y `path`, que reproducen ese caso exacto.
- **F10e, pantallas:** Inicio, Entrar o crear, Lobby, Resultados y Ayuda, con rutas por hash. Con la ficha guardada, el enlace de la sala reanuda la sesión; sin ficha, abre Entrar con el código. «Compartir» usa la hoja del sistema, el portapapeles o un diálogo con el enlace. Sin fotos y una columna por debajo de 1024 px.
- **F10f, estados de red:** banners de reconexión (con las notas en cola) y de servidor no disponible, diálogos de otra pestaña y de versión, la decisión 3 y las transiciones que faltaban. `design/entrega-f8.md` §4 quedó resuelto.
- **F10g, E2E:** Playwright con el build de producción y el servidor real: seis pestañas juegan una partida completa (T-05.4), el reloj desfasado 10 minutos (T-07.2), un corte real con la página cerrada y la vuelta (T-13.5, con verificación negativa sin ficha) y E-08. El inspector revisa cada mensaje WS que reciben las páginas, con un control que debe fallar. Job `e2e` en la CI, sin reintentos.

**Problemas y soluciones:**
- **El modo sin conexión no corta:** en Chromium no cierra los WebSocket ya abiertos, así que T-13.5 no probaba un corte real. Ahora se cierra la página y se abre otra en el mismo contexto, y otro contexto ve `disconnected` y después `connected`.
- **El control del inspector:** los mensajes inyectados con una ruta de WebSocket del navegador no llegan a la captura de tráfico. El mensaje de control se envía desde el servidor, por la conexión real de la página.
- **La CI no corre en las ramas:** solo en `main` y en los PR. Sin PR, la verificación de cada subtarea se hizo en local.

**Tiempo real:** se registra al cerrar F10 (F10i), en la entrada siguiente.

**Siguiente:** F10h, punto de control del usuario.

## 2026-10-25 — F10h y F10i: correcciones del punto de control y cierre de F10

**Punto de control del usuario (F10h):** PC, iPhone y iPad a la vez con `pnpm dev:lan`. Lobby, entrada por enlace, jugadas, notas personales y grupales, reconexión al bloquear el iPad, salir y volver con ficha, recarga, sesión en otra pestaña, caída y reinicio del servidor, «Compartir» (por http con IP cae al diálogo, como estaba decidido), Ayuda, y derrota y victoria con bots. Todo funcionó.

**Hecho (correcciones):**
- **Dificultades en el Lobby:** «30 números iniciales», «22», «10» y «Sin números iniciales», en i18n. Las cantidades salen de `DIFFICULTY_GIVENS` (`packages/protocol`), que también arma `DIFFICULTY_RULES` en `packages/bank`: una sola fuente. Va en el protocolo porque `check-dist` prohíbe el banco en el cliente (T-31.2).
- **Causa de la derrota:** el cliente no conserva lo necesario tras recargar. Al terminar, la sala purga a quienes salieron o expiraron, el snapshot ya no los trae y sus vidas se pierden; con un jugador que salió con 0 vidas, «todos sin vidas» y «mezcla» no se distinguen. Por eso `match.ended` y el snapshot llevan `defeatCause` opcional (`lives`, `gone` o `mixed`), calculado por `defeatCause` (`packages/game`) desde el estado final. El evento del registro no cambia de forma, `replay` da la misma causa y el protocolo sigue en la versión 1 (SPEC 1.8, T-01.6 y T-01.7). Resultados y la franja del tablero usan los textos aprobados; sin causa, los de la mezcla. Pruebas de componentes de los tres casos en vivo y de la recarga, y pruebas I de las tres causas, del snapshot tras la purga y del `replay`.
- **Actividad tras una reconexión (R-38):** si el snapshot trae una partida en curso con jugadas (una celda bloqueada que no es número inicial o algún error), la actividad empieza con «La actividad anterior a la reconexión no está disponible.», y las jugadas nuevas quedan después. Lo que se veía antes del corte en la misma sesión también se reemplaza, porque al historial le faltaría lo ocurrido durante el corte. La alternativa (las últimas 50 jugadas públicas en el snapshot, unas 1–1,5 h) está en `docs/IDEAS_FUTURAS.md`, sección 7.
- **T-32.2 y T-07.3 extendida:** Bea comete un error, el servidor se reinicia y reconstruye la partida desde el registro con sus 2 vidas, −P, 1 error, `scoreReachedAt` y el `startedAt` de antes (el cronómetro incluye el tiempo caído); después Ana termina el tablero y el ranking muestra el error de Bea y su penalización. **Verificación negativa:** con la reconstrucción saltando los `cell.mistake`, la prueba falla («expected { …(9) } to match object { lives: 2, score: -90, …(2) }», `persistence.test.ts:227`); revertido, pasa. Romper `replay` de `packages/game` no la hacía fallar: la reconstrucción tiene su propio recorrido con `applyWithEffects`, así que la verificación se hizo ahí.
- **T-32.1, casos fijos:** todos se caen y pasan 120 s (la sala se borra, `room.not_found` con la ficha y derrota en el registro), y otro con el jugador 0 conectado en el que la sala sigue y `replay` coincide con el estado en vivo. No dependen de `seed` ni de `path`.
- **De 622 a 621 pruebas:** d3bab5d agregó `T-32.1 the harness never makes player 0 leave, drop or come back`, que comprobaba la función `otherSeat` del arnés. 4db2807 dejó que cualquiera saliera, se cayera y volviera, y quitó `otherSeat` con esa prueba. Entre 8ae646a y 4db2807 no cambió ningún otro caso de Vitest (las E2E de 707c0f5 no cuentan en esa suma). La cobertura de la propiedad no bajó: la amplió.

**Problemas y soluciones:**
- **Comandos tomados por repetidos tras un reinicio:** en la T-32.2 extendida, los comandos del cliente que volvió recibían respuestas viejas. El transporte en memoria de las pruebas vuelve a numerar las conexiones desde 1 tras el reinicio, así que los `id` coincidían con los de antes, y la deduplicación se reconstruye desde el registro. El arnés agrega la generación del servidor a los `id`; los clientes reales usan `id` al azar.

**Cierre de F10 (F10i):**
- Criterios de aceptación revisados en `docs/PLAN.md` (F10): las E2E de T-05.4, T-07.2, T-13.5 y E-08 en verde en la CI de `main` (2e2c600) y tres veces seguidas en local al cerrar, sin reintentos; el punto de control; y estas correcciones.
- Verificación final: `check`, `test` (631 pruebas, 57 archivos) y `build` en verde; `pnpm e2e` tres veces seguidas, 5 de 5 cada vez.
- **Horas reales de F10:** la entrada anterior las dejó para el cierre. Con las horas de los commits:
  - 2026-10-24, de 16:30 a 17:40 (UTC−5): F10a a F10d, unas 1,2 h;
  - 2026-10-24, de 18:45 a 19:35 (UTC−5): la corrección de T-32.1 y F10e a F10g, unas 0,8 h;
  - 2026-10-24, de 21:55 a 22:30 (UTC−5): T-32.1 sin excluir al jugador 0, el corte real de T-13.5 y el registro, unas 0,6 h;
  - 2026-10-25, de 00:05 a 00:35 (UTC−5): F10h y F10i, unas 0,5 h.
  - **Total: unas 3,1 h** frente a 5–10 h. Las pausas entre sesiones (la revisión del usuario y el punto de control) no cuentan.
- Comparación de horas en el PLAN, sección 5: de F5 a F10, unas 14,1 h frente a 26–43 h. Se propone bajar F11 de 3–6 h a 2–4 h, pendiente de aprobación; F12 y F13 sin cambios.
- PLAN 1.21 y SPEC 1.8.

**Tiempo real:** unas 0,5 h (F10h y F10i). F10 suma unas 3,1 h.

**Siguiente:** planificar F11 en modo plan, y decidir la recalibración propuesta.


## 2026-10-25 — F11a: plan de F11 aprobado y recalibración

**Hecho:**
- El usuario aprobó la recalibración del cierre de F10: F11 baja de 3–6 h a 2–4 h; F12 y F13 sin cambios. El total de la v1 queda en unas 33–37 h (PLAN 1.22, sección 5).
- Plan de F11 aprobado con las subtareas F11a a F11i y las decisiones del usuario, registradas en `docs/PLAN.md` (F11): cortes reales en el caos (nunca el modo sin conexión) comprobados en el servidor, una semilla fija en cada push y semillas nuevas cada semana; carga con PostgreSQL 18 en dos escenarios (realista y estrés) y punto de control antes de optimizar; corrección en F11 de los hallazgos de seguridad críticos, altos y medios; recomendación sobre Dependabot sin activarla; `scoring:report` sin cambiar los parámetros.
- T(L) queda fuera de la v1, sin evento de selección: `docs/IDEAS_FUTURAS.md`, sección 8, con la alternativa de estimarlo con el tiempo entre jugadas de un mismo jugador.

**Tiempo real:** de 08:35 a 08:55 (UTC−5), unas 0,3 h con la planificación.

**Siguiente:** F11b.

## 2026-10-25 — F11b: E2E de casos límite

**Hecho:**
- `apps/web/e2e/edge.spec.ts`, cuatro E2E de casos de SPEC §7 que tenían prueba de integración en el servidor, pero no en el cliente:
  - **E-10, T-01.2, T-01.6 y T-01.7:** Tomás pierde sus 3 vidas y queda como espectador; Inés, la última activa, pierde la última y la derrota es inmediata. Las dos páginas dicen «Se acabaron las vidas.», `match.ended` trae `defeatCause: "lives"`, Resultados muestra la causa y, al recargar, la sala terminada abre Resultados (decisión 3) con la causa del snapshot.
  - **E-15 y T-32.2:** el servidor se reinicia a mitad de partida (las salas viejas dejan de procesar, se cierran las conexiones con 1012 y arranca otro sobre la misma base y el mismo puerto). Las páginas vuelven solas; Tomás conserva asiento, vidas, puntos, errores, la celda resuelta y su nota personal, el `startedAt` no cambia y la partida sigue.
  - **E-16 y T-32.3:** la base falla más de 10 s. La jugada de Tomás no llega a nadie, la sala se cierra y queda reconstruyéndose; cuando la base vuelve, la página reenvía la jugada pendiente con el mismo `id`, se aplica una sola vez (una fila en el registro) y Tomás no pierde vidas.
  - **E-02, E-23 y T-26.4:** Tomás sale tras un error, cinco personas ocupan los asientos libres, y su vuelta con ficha muestra «no tiene asientos libres». Cuando se libera un asiento, «Volver a la sala» lo devuelve con su `id`, 2 vidas y su error (nunca 3 vidas nuevas).
- El fixture `game` de las E2E ganó `restart()`, `failDatabase()` y `events()` sobre el `FaultyRepository` de las pruebas del servidor. Las ayudas de juego pasaron de `match.spec.ts` a `e2e/game.ts`.
- **Error corregido en el cliente:** con el aviso de sala llena en Inicio, «Volver a la sala» no hacía nada. La ruta de la sala vuelve a Inicio mientras el aviso de esa sala está a la vista (para no repetir el intento rechazado), y el aviso no se quitaba nunca. Ahora el enlace quita el aviso antes de navegar (`dismissNotice`). Prueba de componente nueva (E-02, T-26.4) en `network-states.test.tsx`. **Verificación negativa:** sin el `onClick`, falla («expected '#/' to be '#/sala/…'»); con él, pasa.
- No se agregaron E2E de E-13, E-14, E-18, E-19 ni E-24: sus avisos tienen pruebas de componentes y sus reglas, pruebas de integración.

**Problemas y soluciones:**
- **Primera corrida, 4 fallos, ninguno de tiempo:** la recarga de una sala terminada abre Resultados, no la franja; tras un reinicio o un fallo de la base, el orden en que vuelven las dos páginas decide si el anfitrión recibe la celda como `cell.solved` o en el snapshot (las aserciones ahora miran el estado y no el mensaje); la prueba dejaba activo el modo Notas; y el error real de «Volver a la sala», de arriba. Ningún límite cambió.
- Los `EPIPE` y `ECONNRESET` del proxy de `vite preview` en la salida de la E2E son los cierres del reinicio y de la caída de la base: esperados.

**Verificación:** `check`, `test` (632 pruebas) y `build` en verde; `pnpm e2e` tres veces seguidas, 9 de 9 cada vez, sin reintentos.

**Tiempo real:** de 08:55 a 09:15 (UTC−5), unas 0,35 h.

**Siguiente:** F11c.
