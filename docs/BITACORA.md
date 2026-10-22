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

**Tiempo real:** unos 0,1 h, ejecutado en una sola sesión, sin contar la revisión del usuario.

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

**Tiempo real:** unos 0,6 h, ejecutado en una sesión, sin contar la revisión del usuario.

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

**Tiempo real:** unos 0,4 h (12:39 a 13:05 aproximadamente), ejecutado en una sesión. Incluye la ronda de preguntas, pero no el tiempo de revisión del usuario.

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

**Tiempo real:** unos 0,3 h (15:33 a 15:50 aproximadamente), ejecutado en una sesión. No incluye el tiempo de revisión del usuario.

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
  - `no-non-null-assertion` desactivada en `packages/engine` (índices sobre arreglos tipados con `noUncheckedIndexedAccess`).
  - `tests/lint-helpers.ts` se comparte entre los tests de lint.
- `docs/motor.md` creado (principios y modelo).

**Problemas y soluciones:**
- Un heredoc largo de Bash con varios archivos falló («unexpected EOF»). Los archivos largos se escriben con la herramienta de escritura, no con heredocs encadenados.
- Para la regla de aislamiento se usó `regex` en `no-restricted-imports` en lugar de patrones estilo gitignore, que no se llevan bien con rutas que empiezan con `../`.

**Tiempo real:** unos 0,3 h (15:52 a 16:12 aproximadamente), incluida la planificación de F4. Ejecutado en una sesión, sin contar la revisión del usuario.

**Siguiente:** F4b, solver A.
