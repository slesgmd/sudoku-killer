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
