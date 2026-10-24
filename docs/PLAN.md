# PLAN — Sudoku Killer Multijugador · v1

Versión del plan: 1.18
Estado global: F0 hecha (2026-10-22) · F1 hecha (2026-10-22) · F2 hecha (2026-10-22) · F3 hecha (2026-10-22) · F4 hecha (2026-10-23) · F5 hecha (2026-10-23) · F6 hecha (2026-10-24) · F7 hecha (2026-10-23) · F8 hecha (2026-10-24)
Fuente de verdad del proyecto. Se actualiza al terminar cada fase o cuando se detecte un error de planificación (ver "Mantenimiento del plan").

---

## 1. Visión de la v1

Sudoku killer web en el que hasta 6 personas, identificadas solo con un apodo, se unen a una sala mediante un código y resuelven el mismo tablero en tiempo real, como si estuvieran sentadas alrededor de una mesa.

### Modo Normal (único modo de la v1)
- **Resultado grupal:** el equipo gana si completa el tablero y pierde si todos los jugadores quedan como espectadores.
- **Ranking individual de aporte:** gana el ranking quien más puntos suma.
- **Vidas:** cada jugador tiene 3. Al llegar a 0 pasa a espectador y conserva sus puntos.
- **Jugadas visibles para todos:** cada jugada correcta o errónea se notifica a todos indicando quién la hizo. La celda correcta queda bloqueada. El número erróneo se muestra un instante y luego se retira.
- **Jugadas simultáneas** en la misma celda: el servidor las ordena y gana la primera que procesa. Si es un acierto, las siguientes reciben "ya resuelta" y no se penalizan. Si es un error, el error cuenta, la celda sigue libre y la siguiente jugada se evalúa con normalidad (SPEC R-05).
- **Notas en dos capas:** personales y grupales. Cada jugador elige qué capas ve y en cuál escribe.
- **Temporizador común** controlado por el servidor. No se pausa.

### Fuera de la v1
El modo competitivo entre amigos y cualquier idea nueva se registran en `docs/IDEAS_FUTURAS.md`. No se implementan en esta versión.

---

## 2. Reglas de producto confirmadas

| Tema | Regla v1 |
|---|---|
| Capacidad | Máximo 6 jugadores por sala. Los espectadores conservan su asiento. |
| Acceso | Código de sala y apodo único dentro de la sala. Sin cuentas de usuario. |
| Creador | Solo puede iniciar la partida. No expulsa jugadores ni cierra la sala. |
| Si el creador se va antes de iniciar | El derecho de iniciar pasa al jugador más antiguo de la sala. Aplica también a las partidas siguientes. |
| Entrada con partida en curso | Permitida como jugador con 3 vidas y 0 puntos, si hay cupo. |
| Desconexión | El jugador tiene 2 minutos para volver con su ficha (guardada en el navegador) y recuperar asiento, vidas, puntos y notas. |
| Borrado de sala | Cuando no queda nadie conectado después de ese plazo de 2 minutos. |
| Celdas | Una celda correcta queda bloqueada para siempre. |
| Notas grupales | Operaciones explícitas de agregar o quitar candidato (nunca "alternar"), ordenadas por el servidor. |
| Limpieza automática | Al bloquearse una celda, se borran esos candidatos en su fila, columna, caja y jaula dentro de las notas grupales. En las personales es opcional según el ajuste de cada jugador. |
| Diseño visual | 100 % propio, creado en la fase F7. Está prohibido copiar el diseño visual o la interfaz de la app de referencia. |

---

## 3. Principios de arquitectura (escalable desde la v1)

1. **Monorepo por capas:**
   - `packages/engine`: lógica pura del puzzle, sin E/S.
   - `packages/protocol`: mensajes y esquemas versionados.
   - `packages/scoring`: puntuación pura y parametrizada.
   - `packages/game`: reductor puro de la partida y módulos `GameMode` (ADR 0004).
   - `apps/server`: servidor de salas.
   - `apps/web`: cliente.
2. **Servidor autoritativo.** La solución nunca sale del servidor. Un test automático revisa cada mensaje saliente y falla si contiene la solución.
3. **Registro de eventos por partida.** Cada partida guarda sus eventos en orden. El estado, la puntuación y la reconexión se reconstruyen reproduciendo esos eventos. Esto permite depurar errores y recalibrar la puntuación con partidas reales.
4. **Modos de juego como módulos.** Una interfaz `GameMode` define permisos, puntuación y condiciones de victoria o derrota. El modo Normal es la primera implementación; el competitivo será un módulo nuevo, sin reescribir el resto.
5. **Interfaces de infraestructura:**
   - `RoomStore` (memoria en v1, Redis más adelante).
   - `PuzzleRepository` y `MatchRepository` (base de datos).
   - `Transport` (WebSocket).
   - La v1 corre en una sola instancia, pero sin decisiones que impidan escalar horizontalmente.
6. **Protocolo con versión**, validado en ambos extremos con esquemas compartidos.
7. **Motor preparado para otros tamaños de tablero**, aunque la v1 solo usa 9x9.
8. **Convenciones:**
   - Código e identificadores en inglés; documentación e interfaz en español.
   - Textos de la interfaz preparados para traducción (i18n).
   - TypeScript estricto.
   - Commits con formato Conventional Commits.

**Stack** (confirmado en F2; ver ADR 0001 y 0002):
- pnpm workspaces y TypeScript.
- Cliente: React con Vite.
- Servidor: Node 24 con `ws` y protocolo propio (se descartaron Colyseus y Socket.IO).
- Validación: Zod.
- Base de datos: PostgreSQL con Drizzle; PGlite en las pruebas.
- Pruebas: Vitest y fast-check; Playwright para pruebas de extremo a extremo (E2E).

---

## 4. Protocolo de trabajo

### Archivos de memoria
- **`CONTEXTO.md` (raíz, máximo unas 120 líneas):** resumen del proyecto, fase actual y su estado, próxima tarea concreta, comandos, convenciones, mapa de carpetas y enlaces a decisiones. Es lo único que se carga en cada sesión, así que debe mantenerse breve.
- **`docs/PLAN.md`:** este archivo, con el estado de cada fase.
- **`docs/BITACORA.md`:** historial detallado (qué se hizo, problemas, soluciones, tiempo real dedicado). No se carga automáticamente; se consulta solo cuando hace falta.
- **`docs/adr/NNNN-titulo.md`:** una decisión técnica por archivo.
- **`docs/SPEC.md`:** especificación técnica, generada en F2.
- **`docs/IDEAS_FUTURAS.md`:** todo lo que queda fuera de la v1.

### Ciclo de trabajo
1. Al iniciar una sesión, leer `CONTEXTO.md` y la sección de la fase actual de este plan.
2. Al iniciar una fase, usar el modo plan: proponer las subtareas y esperar aprobación.
3. Trabajar en tareas pequeñas. Cada tarea termina con sus pruebas en verde.
4. **Antes de cerrar cada sesión o reiniciar el contexto:**
   - Actualizar `CONTEXTO.md` (estado y próxima tarea exacta).
   - Agregar una entrada en `BITACORA.md`.
   - Marcar el avance en este plan.
   - Hacer commit.
5. Una fase solo se marca como terminada cuando cumple todos sus criterios de aceptación.

### Mantenimiento del plan
- Si aparece un error de planificación o un cambio de alcance, se edita la fase afectada, se sube la versión (1.02, 1.03, ...) y se registra el cambio en la sección 8.
- Los tiempos reales se anotan para recalibrar las estimaciones de las fases siguientes.

---

## 5. Resumen de fases

Las horas son de trabajo efectivo de una persona, incluyendo revisión y pruebas, con un margen de ±40 %. Desde el cierre de F4, las de F5 a F13 son las de la recalibración aprobada (abajo); las de F0 a F4 son las originales.

| Fase | Nombre | Horas estimadas | Depende de | Estado | Horas reales |
|---|---|---|---|---|---|
| F0 | Entorno y arranque | 2–4 | — | Hecha | ~0,1 |
| F1 | Estudio de referencia con REA | 3–6 | F0 | Hecha | ~0,6 |
| F2 | Especificación y arquitectura | 6–10 | F1 | Hecha | ~0,4 |
| F3 | Monorepo y calidad | 3–5 | F2 | Hecha | ~0,3 |
| F4 | Motor del puzzle | 20–35 | F3 | Hecha | ~3,4 (F4a ~0,3 + 0,1 de corrección · F4b ~0,6 · F4c ~1,1 · F4d ~0,4 · F4e ~0,4 · F4f ~0,5) |
| F5 | Banco de puzzles y dificultad | 2–4 | F4 | Hecha | ~2,0 (1,2 + 0,8 por los números iniciales por dificultad) |
| F6 | Sistema de puntuación | 2–5 | F4 | Hecha | ~2,2 |
| F7 | Diseño visual propio | 10 | F2 (puede ir en paralelo con F4–F6) | Hecha | ~1,5 |
| F8 | Cliente con servidor local simulado | 4–8 | F4, F7 | Hecha | ~3,4 |
| F9 | Servidor de salas | 3–6 | F3, F5, F6 | Pendiente | |
| F10 | Integración en tiempo real | 5–10 | F8, F9 | Pendiente | |
| F11 | Pruebas integrales, carga y seguridad | 3–6 | F10 | Pendiente | |
| F12 | Despliegue privado | 2–4 | F11 | Pendiente | |
| F13 | Beta cerrada y cierre de la v1 | 10 (+1–2 semanas de calendario) | F12 | Pendiente | |
| **Total** | | **unas 46–68 h** (41–63 h de F5 a F13 y unas 4,8 h reales de F0 a F4; la estimación original era de 130–230 h). F10 pasó de 4–8 h a 5–10 h al cerrar F8 (plan 1.18). | | | |

Equivale a unas **2,5–4,5 semanas** dedicando 15–20 horas por semana, más las 1–2 semanas de calendario de la beta. Si otra persona trabaja F7 en paralelo, el total se reduce en unas 10 h.

### Recalibración al cerrar F4 (aprobada por el usuario el 2026-10-23, con F7 y F13 en 10 h)

**Evidencia.** F4 llevó unas **3,4 h reales** frente a las 20–35 h estimadas: entre el 10 % y el 17 % de la estimación. Cada subfase quedó por debajo de su rango (la más larga, F4c, con 1,1 h frente a 3–5 h). De F0 a F4 se usaron unas **4,8 h** frente a 34–60 h: entre el 8 % y el 14 %. Las horas reales son las de las sesiones de trabajo anotadas en la BITÁCORA, y no cuentan el tiempo que el usuario dedica a revisar fuera de ellas.

**Por qué no aplicar el mismo factor a todo.** F4 era código puro con oráculos automáticos (dos solvers, fuerza bruta, corpus), el caso más favorable. Las fases siguientes tienen partes que no se aceleran igual: interfaz que hay que mirar en el navegador (F7, F8), integración en tiempo real con más ciclos de depuración (F10), cuentas, dominio y secretos del usuario (F12), y pruebas con personas (F5, F13). La propuesta usaba entre el 25 % y el 35 % de la estimación original, el doble de lo observado, como margen. El usuario la aprobó con un cambio: F7 y F13 quedan en 10 h cada una.

| Fase | Estimación original (h) | Aprobada (h) | Motivo |
|---|---|---|---|
| F5 | 6–12 | 2–4 | El lote y los histogramas son automáticos; la prueba manual con jugadores es tiempo de personas. |
| F6 | 10–18 | 2–5 | Paquete puro con simulación Monte Carlo, parecido a F4. |
| F7 | 10–20 | 10 | Las iteraciones de diseño dependen de la revisión del usuario. Se propusieron 4–8 h; el usuario la fijó en 10 h. |
| F8 | 15–25 | 4–8 | Interfaz en React; se verifica en el navegador. |
| F9 | 15–25 | 3–6 | El protocolo y las reglas ya están en la SPEC; pruebas con PGlite. |
| F10 | 15–25 | 4–8 | Mayor riesgo de integración (reconexión, concurrencia). |
| F11 | 10–16 | 3–6 | Playwright, carga y seguridad, automatizables. |
| F12 | 5–10 | 2–4 | Requiere cuentas, dominio y secretos del usuario. |
| F13 | 10–20 (+1–2 semanas) | 10 (+1–2 semanas) | Beta con personas: el calendario no se acorta. Se propusieron 4–8 h; el usuario la fijó en 10 h. |
| **F5–F13** | **96–171** | **40–61** | |

Con lo ya hecho (unas 4,8 h), el total de la v1 queda en unas **45–66 h**, frente a 130–230 h. La columna «Horas estimadas» de la tabla de arriba ya usa estos valores. Se vuelve a comparar al cerrar F5 y F10. Desde el plan 1.18, con F10 en 5–10 h, el total es de unas 46–68 h.

**Comparación al cerrar F5 (2026-10-23):**
- F5 llevó unas 2,0 h frente a 2–4 h (entre el 50 % y el 100 %), con los números iniciales por dificultad incluidos, y F7, unas 1,5 h frente a 10 h (15 %).
- De F0 a F7 van unas 8,3 h reales.
- La recalibración se mantiene sin cambios. F5 y F7 quedaron por debajo, pero las fases que vienen (F8 a F13) tienen la interfaz, la integración en tiempo real, el despliegue y la beta con personas, que se aceleran menos.
- La prueba en papel de F5 la hizo el usuario fuera de las sesiones y no entra en estas horas. La segunda muestra queda pendiente.
- Próxima comparación: al cerrar F10.

---

## 6. Fases en detalle

### F0 — Entorno y arranque (2–4 h)
**Objetivo:** dejar el repositorio listo y la memoria del proyecto funcionando.

**Tareas:**
- Verificar Node, pnpm, Git, las herramientas de desarrollo y REA.
- Hacer `git init` y crear `.gitignore`.
- Crear `CONTEXTO.md`, `docs/BITACORA.md`, `docs/IDEAS_FUTURAS.md` (con el modo competitivo como primera entrada) y la carpeta `docs/adr/`.

**Criterios de aceptación:**
- Los archivos existen.
- `CONTEXTO.md` tiene menos de 120 líneas y apunta a F1.
- Primer commit hecho.

**Estado:** hecha el 2026-10-22. Se cumplen todos los criterios de aceptación (ver la entrada de `BITACORA.md`).

### F1 — Estudio de referencia con REA (3–6 h)
**Objetivo:** documentar el **comportamiento** de la app de referencia (https://sudoku.com/es/killer), no su diseño visual.

**Tareas:**
- Usar las herramientas de navegador de REA (skill oficial reverse-engineer-anything; verifica con binary_session que inspect_web_page y capture_browser_scenario estén disponibles).
- Revisar en la captura de red si los puzzles vienen del servidor o se generan en el navegador.
- Documentar el formato de datos de un puzzle.
- Documentar cómo funcionan las notas, el resaltado, los errores, las vidas, el temporizador, las pistas y los niveles de dificultad.

**Entregable:** `docs/referencia.md`, escrito con palabras propias y separando lo observado de lo inferido. No incluye capturas ni descripciones de colores, tipografías o maquetación.

**Criterios de aceptación:**
- Cada comportamiento documentado está marcado como observado o inferido.
- Las preguntas sin resolver quedan listadas.

**Estado:** hecha el 2026-10-22. `docs/referencia.md` marca cada punto como observado, visto en el código o inferido, cita la evidencia de `evidence/f1-referencia.json` y lista 14 preguntas abiertas. Las notas, deshacer, pistas y pausa no se vieron en ejecución: tras dos cargas fallidas, el usuario decidió no hacer más cargas automáticas de la página. La sección 15 de `referencia.md` (observaciones manuales) se descartó en F2 porque las reglas propias ya cubren esos puntos.

### F2 — Especificación y arquitectura (6–10 h)
**Entregables:**
- **`docs/SPEC.md`** con:
  - Modelo de datos.
  - Catálogo de mensajes del protocolo, con su versión.
  - Máquinas de estado de la sala (`esperando → en curso → terminada`) y del jugador (`activo → espectador → desconectado → expirado`).
  - Reglas de la sección 2 expresadas como casos verificables.
  - Casos límite: desconexiones, jugadas simultáneas, salida del creador, sala vacía, reconexión en medio de un evento.
  - Interfaz `GameMode`.
  - Plan de pruebas.
- **ADRs:** 0001 stack, 0002 comunicación en tiempo real, 0003 persistencia, 0004 registro de eventos, 0005 notas grupales.

**Preguntas abiertas:**
- Pistas en v1: ¿existen?, ¿cuántas?, ¿individuales o compartidas?, ¿afectan la puntuación? → **Resuelta (P1):** sí; 3 por partida, compartidas por el equipo; cuestan −H puntos a quien la usa y no dan bonus.

**Criterios de aceptación:**
- Cada regla de la sección 2 tiene al menos un caso de prueba definido.
- No quedan preguntas abiertas sin dueño.

**Estado:** hecha el 2026-10-22.
- Entregables: `docs/SPEC.md` (34 reglas R-xx con sus casos T-xx, 24 casos límite y la matriz de cobertura de la sección 2 en SPEC §8.5) y los ADR 0001–0005.
- Las decisiones de producto se tomaron en una sola ronda con el usuario (SPEC §1.2).
- Las 14 preguntas de `referencia.md` y la de pistas tienen su resolución o su dueño (SPEC §1.4).

### F3 — Monorepo y calidad (3–5 h)
**Tareas:**
- Estructura `apps/` y `packages/`, incluido `packages/game`.
- TypeScript estricto, linter y formateador (ESLint con `typescript-eslint` y Prettier, ADR 0001). Una regla de lint prohíbe `Date.now()` y `Math.random()` en `packages/game`, `engine` y `scoring`.
- Vitest configurado.
- Scripts `dev`, `test`, `check` y `build`.
- CI básica en GitHub Actions.
- Hooks de pre-commit.

**Criterios de aceptación:**
- `pnpm check` y `pnpm test` pasan con un paquete de ejemplo.
- La CI está en verde.

**Estado:** hecha el 2026-10-22.
- Monorepo pnpm con `packages/{engine,protocol,scoring,game}` y `apps/{server,web}`. TypeScript 6.0 estricto (ver la nota de F3 en el ADR 0001), ESLint con reglas con tipos, Prettier, Vitest, Husky con lint-staged y CI en GitHub Actions (`check`, `test` y `build` en Linux).
- Paquete de ejemplo: `cellIndex` en `engine`, con una prueba de propiedades.
- Pruebas: T-31.3 (`protocol` no exporta ningún tipo con `solution`, con un fixture de control) y la regla de lint contra `Date.now()` y `Math.random()` en los paquetes puros.
- `pnpm check`, `pnpm test` y `pnpm build` pasan en local y la CI está en verde (run 39851785929). El repositorio remoto es público por decisión del usuario.
- Antes de F3 se precisó R-05 en la SPEC (versión 1.1): jugadas simultáneas y el nuevo T-05.5.

### F4 — Motor del puzzle (20–35 h)
**Componentes de `packages/engine`:**
- Modelo de tablero y jaulas.
- Validador de jugadas.
- **Solver A:** backtracking con propagación de restricciones y combinaciones de suma por jaula. Cuenta soluciones y se detiene al encontrar la segunda.
- **Solver B:** un algoritmo distinto (por ejemplo, Dancing Links) para verificación cruzada.
- **Generador:**
  1. Generar una solución completa aleatoria.
  2. Dividirla en jaulas conectadas de 2 a 5 celdas sin dígitos repetidos.
  3. Calcular las sumas.
  4. Verificar que tiene solución única.
  5. Si tiene más de una, ajustar jaulas o agregar un número inicial, y volver a verificar. Solo hay números iniciales cuando hacen falta para la unicidad o en el nivel fácil; cada puzzle registra el motivo en `givensReason` (SPEC R-20). Desde F5 (versión 2 de la equivalencia), los números iniciales se escalonan por dificultad.
- **Función `cleanupPeers(celda, dígito)`:** la limpieza automática de notas (SPEC R-17, ADR 0005). Su comportamiento se fija con tests porque la reproducción del registro depende de ella.
- **Calificador humano:** técnicas por niveles de complejidad.
  - Nivel 1: singles.
  - Nivel 2: combinaciones obligatorias de jaula.
  - Nivel 3: regla del 45 (innies y outies).
  - Nivel 4: pares y tríos, interacciones entre jaulas.
  - Nivel 5 en adelante: técnicas avanzadas.
- **Función `nivelParaDeducir(celda, estado)`:** nivel mínimo de técnica con el que una celda queda determinada a partir del estado actual del tablero. La usa la puntuación en F6.

**Pruebas matemáticas:**
- Pruebas basadas en propiedades: toda solución generada cumple las reglas, la suma de cada jaula coincide y no hay dígitos repetidos en ninguna jaula.
- 1000 puzzles generados con solución única confirmada por **ambos** solvers. Cualquier discrepancia entre ellos bloquea la fase.
- Casos conocidos de la literatura con resultado esperado.

**Subfases** (aprobadas el 2026-10-22). Cada una termina con las pruebas en verde, commit, push, CI en verde y `CONTEXTO.md` apuntando a la siguiente, para poder hacer `/clear` entre ellas. Las pruebas del motor están en SPEC R-35 (T-35.1 a T-35.6).

| Subfase | Contenido | Horas estimadas | Estado |
|---|---|---|---|
| F4a | Tipos, geometría, máscaras, validación de estructura y solución, `checkPlacement`, `isEvidentMistake`, `cleanupPeers` y lint de aislamiento entre solvers | 2–4 | Hecha (~0,3 h) |
| F4b | Solver A: combinaciones por jaula, propagación y backtracking con MRV; fuerza bruta 4×4 como oráculo | 3–5 | Hecha (~0,6 h) |
| F4c | Solver B: Dancing Links propio (no importa nada de A); verificación cruzada y puzzles de referencia verificados por A y B | 3–5 | Hecha (~1,1 h) |
| F4d | Generador con PRNG con semilla; prueba rápida en la CI y corpus de 1000 puzzles aparte (`pnpm test:corpus` y workflow programado); tiempos en `docs/motor.md` | 4–7 | Hecha (~0,4 h) |
| F4e | Calificador, niveles 1 a 3, y `levelToDeduce` | 4–7 | Hecha (~0,4 h) |
| F4f | Calificador, niveles 4 y 5; histograma preliminar y cierre de F4 | 4–7 | Hecha (~0,5 h) |

- La prueba de 1000 puzzles no corre en la CI de cada push: la CI ejecuta una versión reducida y el corpus completo corre en local y en un workflow programado.
- Si no hay una fuente pública legible por máquina para los puzzles de referencia, se usan casos con resultado conocido por construcción, y se registra la desviación.
- **Desviación registrada en F4c:** no se usó ninguna fuente pública (no se hacen más cargas de sudoku.com y no hay otra legible por máquina a mano). Los 13 puzzles de referencia (`packages/engine/test/fixtures/reference-puzzles.ts`) se construyeron sobre cuadrículas válidas, con 0, 1 y de 2 a 4 soluciones en 4×4, 6×6 y 9×9. Su resultado lo calcularon A y B con `limit: Infinity` y lo confirmó el validador.
- **Refuerzo de F4c (pedido por el usuario, 2026-10-23):** `solveB` tiene la opción `prune: false` (Dancing Links puro), y B con poda y sin ella coinciden en 4×4, 6×6 y 9×9 con números iniciales (prueba en la CI y 4307 puzzles medidos, 0 diferencias). Las pruebas aleatorias imprimen la semilla en todo fallo, y cada semilla que falle se agrega como regresión fija (`docs/motor.md`).
- **Nota para F4d (pedida por el usuario, 2026-10-22):** el generador usa `solveA` con un presupuesto de nodos o de tiempo (hoy `solveA` no tiene presupuesto: se agrega en F4d). Si un candidato lo excede, se descarta y se genera otro. Se mide y documenta cuántos candidatos se descartan. B verifica después cada puzzle aceptado; su coste en puzzles únicos está medido en `docs/motor.md` (media 13 ms y máximo 0,7 s en 9×9).
- **Hecho en F4d (2026-10-23):** el presupuesto es de nodos (`solveA` con `maxNodes`), porque el motor no lee el reloj. Con el valor por defecto (1000 nodos), el corpus de 1000 puzzles 9×9 descartó 1 de 1001 candidatos; la tabla con otros presupuestos está en `docs/motor.md`. Tiempo medio de generación en 9×9: 39 ms, con la verificación de B incluida. 0 discrepancias entre A y B; el 0,7 % de los puzzles necesita números iniciales para la unicidad.
- **Pedido del usuario para el calificador (2026-10-23):** cada técnica es una función aislada que devuelve sus deducciones (colocar un dígito o quitar un candidato) con su nivel; se aplica siempre el nivel más bajo con deducciones. Una prueba de propiedades sobre el corpus comprueba que ninguna deducción contradice la solución única, y cualquier fallo bloquea la subfase. Si las técnicas no alcanzan, el puzzle queda como «excede las técnicas»: nunca se adivina. `levelToDeduce` usa solo los dígitos colocados, no las notas, es determinista y su tiempo en 9×9 (media y p95) se documenta en `docs/motor.md`. Al cerrar F4f se informa la distribución de niveles del corpus para F5.
- **Hecho en F4e (2026-10-23):** niveles 1 (singles y última celda de jaula), 2 (combinaciones y dígitos obligatorios de jaula) y 3 (innies y outies), `grade` y `levelToDeduce`. Corpus de 1000 puzzles 9×9: 365 264 deducciones, 0 contra la solución. Nivel máximo: 0 puzzles de nivel 1, 100 de nivel 2, 668 de nivel 3 y 232 que exceden las técnicas. `levelToDeduce` en partidas simuladas: media 0,77 ms y p95 4,7 ms (`docs/motor.md`).
- **Pedido del usuario para F4f (2026-10-23):** los mismos requisitos de F4e (técnicas aisladas, prueba de corrección contra la solución en el corpus y nunca adivinar); volver a medir `levelToDeduce` con los niveles 4 y 5, con un p95 en 9×9 por debajo de 50 ms; informar la distribución final del corpus; registrar dos decisiones pendientes en F5 y cerrar F4 con la comparación de horas y una recalibración propuesta (sección 5).
- **Hecho en F4f (2026-10-23):** nivel 4 (`lockedCandidates`, `nakedPair`, `hiddenPair`, `cageUnitLock`, `nakedTriple` y `hiddenTriple`) y nivel 5 (`xWing`, `yWing`, `swordfish` y `unitCombination`), cada una contra un oráculo por fuerza bruta. Corpus de 1000 puzzles 9×9: 401 109 deducciones, 0 contra la solución. Nivel máximo: 0 de nivel 1, 100 de nivel 2, 668 de nivel 3, 77 de nivel 4, 85 de nivel 5 y **70 (7,0 %) que exceden todas las técnicas** (eran 232). `levelToDeduce` en 100 partidas simuladas: media 1,5 ms y **p95 9,2 ms**, dentro del límite de 50 ms. `grade`: media 25 ms (`docs/motor.md`).
- **Cierre de F4 (2026-10-23):** unas 3,4 h reales frente a 20–35 h estimadas (entre el 10 % y el 17 %). Recalibración propuesta de F5 a F13 en la sección 5.

**Criterios de aceptación:**
- 0 discrepancias entre solvers.
- 100 % de los puzzles con solución única.
- Tiempo medio de generación medido y documentado.

### F5 — Banco de puzzles y calibración de dificultad (2–4 h; original 6–12 h)
**Tareas:**
- Script de generación por lotes.
- Esquema de base de datos `puzzles` (la solución solo se guarda en el servidor).
- Mapeo de los niveles de técnica del calificador a los niveles de juego.

**Calibración:**
- Histograma de la técnica máxima requerida y del número de pasos por nivel.
- Prueba manual con jugadores en un muestreo de puzzles de cada nivel.

**Criterios de aceptación:**
- Al menos 500 puzzles por nivel.
- Distribuciones documentadas en `docs/dificultad.md`.
- Ningún puzzle fácil requiere técnicas de nivel 4 o superior.

**Datos de partida (corpus de F4f, 1000 puzzles 9×9 sin números iniciales, `docs/motor.md`):** nivel máximo 2 en 100, 3 en 668, 4 en 77, 5 en 85, y 70 que exceden todas las técnicas. Ninguno es de nivel 1. Pasos por puzzle: mediana 51.

**Decisiones** (registradas al cerrar F4 como pendientes y aprobadas por el usuario el 2026-10-23):
- **a) Puzzles que exceden todas las técnicas: se excluyen del banco de la v1.** Son el 7,0 % del corpus. El script de lotes los descarta y registra cuántos. Así, todo puzzle del banco tiene `graderMaxLevel` entre 1 y 5, y como agregar celdas correctas no sube el nivel (T-35.5), `levelToDeduce` nunca devuelve `UNRATED` en una partida, porque el servidor solo coloca dígitos correctos. F6 puede contar con eso.
- **b) Nivel fácil: se obtiene generando más puzzles y filtrando.** Solo el 10 % de los puzzles generados se resuelve con técnicas de nivel 2 o menos (ninguno con nivel 1): para 500 fáciles hacen falta unos 5000 candidatos, unos 6 minutos a unos 70 ms cada uno (generación y calificación). Los números iniciales del nivel fácil (`easyGivens`, que permite la decisión P2 de la SPEC) se usan solo si la prueba manual muestra que el fácil resulta difícil. Ajustar `cageSizeWeights` hacia jaulas más chicas queda descartado.
  - **Reemplazada el 2026-10-23** tras la prueba en papel, en la que los puzzles sin números iniciales resultaron difíciles, incluido el fácil.
  - Ahora los números iniciales se escalonan por dificultad: 30, 22, 10 y 0, con bandas de niveles que no se solapan (`docs/dificultad.md`, versión 2).
- **c) La equivalencia entre los niveles del calificador y las dificultades del juego se decide en F5**, con el informe para F5 del calificador (`docs/motor.md`, «Informe para F5»): uso de cada técnica y peso de `unitCombination` en el nivel 5.

**Pedido del usuario al planificar (2026-10-23):**
- acotar `unitCombination` y medir las cotas 4/8, 5/16 y 5/32, con las mismas pruebas de F4e y F4f;
- proponer la equivalencia con histogramas;
- script de lotes con descartes y tiempos;
- esquema `puzzles` con Drizzle y evaluar un manifiesto de semillas;
- escribir `docs/dificultad.md`;
- proponer cómo tratar la prueba manual sin cliente.

Al aprobar el plan, el usuario pidió además:
- una prueba de que `levelToDeduce` nunca devuelve `UNRATED` en partidas sobre puzzles del banco (T-20.5);
- justificar el `id` opaco por la enumeración del banco y no por la solución;
- documentos en español neutro;
- un punto de control después de medir las cotas.

**Subtareas:**

| Subtarea | Contenido | Estado |
|---|---|---|
| F5a | `unitCombination` acotada (`unitCombinationWithin`, `GRADER_VERSION` "2"), oráculo con cota y medición de las cotas en el corpus. Punto de control: cota y equivalencia aprobadas por el usuario. | Hecha |
| F5b | `difficultyOf` (equivalencia versión 1), `Difficulty` y `PublicPuzzle` en el protocolo, `buildBank` y el script `bank:generate`, manifiesto versionado y `docs/dificultad.md`. | Hecha |
| F5c | Drizzle: tabla `puzzles` con su migración, `PuzzleRepository`, `loadBank` idempotente y pruebas con PGlite. SPEC 1.3 (T-20.3 a T-20.5) y ADR 0006. | Hecha |
| F5d | Muestra imprimible (`bank:sample`, `design/muestra-f5/muestra.html`) y cierre. | Hecha |

**Estado:** hecha el 2026-10-23, en unas 1,2 h. Después de la prueba en papel se agregaron los números iniciales por dificultad (unas 0,8 h más, abajo).
- **Cota de `unitCombination`: 4 jaulas abiertas y 8 combinaciones**, aprobada.
  - Conserva 39 de los 85 puzzles de nivel 5 del corpus (5/16 conserva 75 y 5/32, 77).
  - 500 de nivel 5 salen en unos 10 minutos.
  - Las pruebas siguen en verde: 0 deducciones contra la solución, monotonía en 9000 comparaciones y oráculo con cota.
- **Equivalencia, versión 1, aprobada:**
  - fácil: nivel máximo 2 o menos;
  - media: nivel 3 con un solo paso de nivel 3;
  - difícil: nivel 3 con 2 o más pasos de nivel 3, o nivel 4;
  - experto: nivel 5;
  - se excluyen los que exceden.
  - Se recalibra con la muestra impresa y en F13.
- **Banco:**
  - 2000 puzzles (500 por dificultad) de las semillas 1 a 15 254, en 9,2 minutos;
  - 1589 excluidos (10,4 %);
  - ningún fácil usa técnicas de nivel 3 o más;
  - manifiesto de semillas en `apps/server/bank/manifest.json` (ADR 0006).
- **Base de datos:**
  - tabla `puzzles` con Drizzle y su migración, y `PuzzleRepository` con `getForServer` y `getPublic`;
  - el `id` es un UUID opaco, y ni la solución ni la semilla salen en el puzzle público;
  - `loadBank` verifica cada semilla y es idempotente;
  - pruebas con PGlite.
- **T-20.5:**
  - en partidas simuladas sobre los 2000 puzzles del banco, `levelToDeduce` nunca devuelve `UNRATED`;
  - la CI usa una muestra y `pnpm test:corpus`, el banco completo.
- **Desviación registrada:**
  - la prueba manual con jugadores se hace en papel con una muestra imprimible de 12 puzzles (`docs/dificultad.md`, sección 6);
  - la prueba con varios jugadores en tiempo real queda para F8 y F13.

**Números iniciales por dificultad (2026-10-23, después de la prueba en papel):**
- **Resultado de la prueba en papel:** sin números iniciales, los puzzles resultan difíciles, incluido el fácil.
- **Medición previa a la decisión:**
  - con números al azar, el nivel cae demasiado rápido: con 10 números, el 99 % queda en nivel 2;
  - con números agregados con guarda (cada uno solo si mantiene el piso de la banda), las cantidades pedidas salen en el 87 % al 100 % de los candidatos.
- **Decisión del usuario:**
  - fácil, 30 números y nivel máximo 1;
  - media, 22 y nivel máximo 2;
  - difícil, 10 y nivel 3 o 4 con algún paso de nivel 3;
  - experto, 0 y nivel 5;
  - celdas con guarda, repartidas por cajas y con semilla;
  - cada semilla pertenece a una sola dificultad;
  - `GENERATOR_VERSION` "2";
  - A también confirma la unicidad.
- **Hecho:**
  - `addGivens` en el motor, que reemplaza a la opción `easyGivens`;
  - `givensReason` pasa a `'none' | 'difficulty' | 'uniqueness'`, con su migración;
  - equivalencia versión 2;
  - manifiesto regenerado: 17 090 candidatos en 13,1 minutos, con tasas de 99 %, 100 %, 88,5 % y 3,2 %;
  - SPEC 1.4 (P2, T-20.2 y T-20.3);
  - muestra nueva para una segunda prueba en papel.
- **T-20.5 sigue valiendo:** en partidas simuladas sobre los 2000 puzzles nuevos, `levelToDeduce` nunca devuelve `UNRATED`.
- **Observación para la segunda prueba:** la guarda deja el mínimo de técnica, así que casi todas las medias necesitan un solo paso de nivel 2 y todas las difíciles, uno solo de nivel 3.
- **Pasa a F9:** el driver de PostgreSQL, el comando `bank:load`, la comprobación al arrancar y la elección al azar sin repetir.

### F6 — Sistema de puntuación (2–5 h; original 10–18 h)
**Modelo inicial** (los parámetros viven en `scoring/params.v1.json` y se versionan):
- **Acierto en la celda c:** `V(c) = B × w(nivelParaDeducir(c, estado actual))`. Recompensa resolver celdas difíciles, no correr por las fáciles. Valores iniciales: B = 10 y pesos w = 1; 1,5; 2; 3 para los niveles 1 a 4 o más.
- **Error:** `−P` además de perder una vida. P se calibra para que adivinar entre 2 o más candidatos tenga un valor esperado negativo frente a deducir.
- **Cierre de jaula, fila, columna o caja:** bonus β para quien coloca la última celda. Este bonus no debe superar el 20 % del puntaje típico de una partida.
- **Notas:** no dan puntos en la v1, para evitar el spam.
- **Pista:** `−H` para quien la usa, sin bonus de cierre para nadie (SPEC R-19). H se calibra para que pedir una pista nunca dé más puntos que no pedirla, y para que no compense usarla para quitarles celdas difíciles a otros.
- **Desempate:** primero menos errores; después, quien alcanzó antes su puntaje final.
- **Determinismo:** `puntaje = f(registro de eventos, versión de parámetros)`. Se puede recalcular cualquier partida con parámetros nuevos.

**Pruebas matemáticas:**
- Propiedades: determinismo, cotas, monotonía (más aciertos del mismo nivel dan más puntos) e independencia del orden de llegada de mensajes que no se afectan entre sí.
- **Simulación Monte Carlo** con bots y mesas de 2 a 6 jugadores, al menos 10 000 partidas:
  - Bot lógico: deduce con el calificador.
  - Bot veloz: toma siempre la celda más fácil.
  - Bot adivinador: adivina cuando no encuentra deducciones.
  - Variación de la velocidad de cada bot.
  - Uso de pistas (3 por partida, compartidas).
  - Incluir como modelo de comparación (baseline) en la simulación Monte Carlo una fórmula basada en velocidad (base por dificultad, decreciente según el tiempo desde la jugada anterior, con mínimo y multiplicador por completar fila, columna o caja) y demostrar que el modelo propio reduce la ventaja de correr por celdas fáciles.
- **Métricas y objetivos iniciales:**
  - Correlación de Spearman entre el aporte real (deducciones difíciles) y el puntaje: al menos 0,8.
  - Valor esperado de adivinar: menor que 0.
  - El bot veloz no supera al bot lógico de igual velocidad en más del 55 % de las partidas.
  - Análisis de sensibilidad de B, w, P y β.

**Entregable:** `docs/puntuacion.md` con las fórmulas, los resultados y la justificación de los parámetros elegidos.

**Criterios de aceptación:**
- Se cumplen todas las métricas objetivo.
- **Revisión constante:** el modelo se recalibra en F11 y en F13 usando registros de partidas reales.

**Pedido del usuario al planificar (2026-10-23):**
- modelo puro con las firmas de `GameMode`, nivel calculado sobre el estado anterior;
- una métrica de aporte real independiente de la fórmula;
- la condición sobre P para k = 2;
- pistas que nunca den más puntos, incluido lo que dejan libre;
- estimar y contener el tiempo de la simulación;
- propiedades en la CI y la simulación completa fuera de ella;
- un punto de control después de la primera simulación.

**Al aprobar el plan, el usuario agregó:**
- el nivel se calcula con los descartes públicos de los errores;
- vidas y derrotas en el simulador, con la tasa por dificultad y por tipo de bot;
- robustez con dos perfiles alternativos de T(L);
- en el punto de control, los puntos por segundo de cada nivel y el puntaje típico;
- no forzar la calibración si P o H quedan desproporcionados.

**Subtareas:**

| Subtarea | Contenido | Estado |
|---|---|---|
| F6a | Motor: descartes públicos en `BoardState` y `levelsToDeduce` (T-35.7 y T-35.8). | Hecha |
| F6b | `packages/scoring`: parámetros con Zod, `createScoring`, `scoreLog` y `rankPlayers` (T-02.1 a T-02.3, T-19.5, T-32.4 y T-36.1 a T-36.5). | Hecha |
| F6c | Simulador (`apps/server/scripts/scoring-sim/`): bots, vidas, R-05, pistas con placebo, aporte contrafáctico con réplicas, modelo de velocidad e hilos de trabajo. Punto de control con los parámetros iniciales. | Hecha |
| F6d | Metas nuevas, calibración (`scoring:calibrate`) y validación con semillas nuevas. | Hecha |
| F6e | `docs/puntuacion.md`, SPEC 1.5, prueba del corpus y cierre. | Hecha |

**Estado:** hecha el 2026-10-24, en unas 2,2 h, frente a 2–5 h. Detalle en `docs/puntuacion.md`.
- **Parámetros v1:** B = 10, w = 1/2/3/4/5, P = 90, β = 1 y H = 60.
- **Nivel con descartes públicos:** el dígito de un error se descarta para `levelToDeduce`, y así adivinar «hasta acertar» no cobra el nivel alto.
- **Condición corregida:** P > B·(w(L) + w(s)), con s el nivel del adivinador.
- **Aporte real:** el tiempo que el equipo pierde sin el jugador, medido con réplicas. No usa la fórmula de puntuación.
- **Cambio de metas en el punto de control** (decisión del usuario):
  - el aporte independiente muestra que el veloz y el lógico aportan lo mismo (el veloz aporta más en el 49 % de los duelos), así que la meta del 55 % se reemplazó por una de equidad entre cuotas de puntaje y de aporte;
  - el Spearman se mide contra el techo de confiabilidad del aporte;
  - el adivinador queda fuera de la equidad a propósito: que adivinar no se premie es lo buscado.
- **Calibración:** ninguna de las 81 combinaciones de la grilla cumplió la equidad. El usuario eligió la más cercana, con P = 90.
- **Validación** (semilla 2, 10 000 partidas, 8 réplicas, tres perfiles de T(L)):
  - Se cumplen las metas exigidas: P y H con sus reglas, adivinar con EV negativo frente a deducir (nivel 2 con su intervalo de confianza y nivel 3 en media), pista y robo con efecto neto negativo frente al placebo, y β con p95 de 9,9 %.
  - **Limitaciones conocidas:** el veloz gana alrededor del 57 % de los duelos (49 % por aporte), el Spearman agrupado es de 0,78 y los estratos de experto quedan por debajo del techo. Los resultados dependen del modelo del mundo.
- **Para F11 y F13:** la primera prioridad es recalibrar el tamaño de P (hoy es el 78 % del puntaje mediano de un jugador en fácil), con la opción de escalarlo por dificultad. Qué medir: `docs/puntuacion.md`, sección 11.
- **Para F9:** guardar `level` y `graderVersion` en el evento del acierto, y los descartes en `Match.excluded`.
- **Desviación registrada:** la meta «pedir una pista nunca da más puntos» se mide en media frente a un placebo. Rama por rama la partida se desvía y el ruido va en los dos sentidos.

### F7 — Diseño visual propio (10 h; original 10–20 h)
**Tareas:**
- Definir la identidad propia: tono, paleta, tipografía e iconografía, todas creadas desde cero.
- Tokens de diseño (colores, espaciados, tipografías).
- Componentes: tablero, jaulas con sus sumas, capas de notas, teclado numérico, barra de jugadores (vidas y puntos), notificaciones de jugadas, lobby, pantalla de sala y pantalla de resultados.
- Wireframes y luego un prototipo de alta fidelidad, en versión móvil y escritorio.
- Accesibilidad:
  - Contraste AA.
  - Los errores y aciertos no se comunican solo con color.
  - Navegación completa con teclado.
- Animaciones breves y con propósito.

**Criterios de aceptación:**
- Guía de estilo en `docs/diseno.md`.
- Revisión explícita de que nada replica la interfaz de la app de referencia.

**Estado: hecha (2026-10-23, ~1,5 h reales).** El diseño se hizo fuera del repositorio y se importó como prototipo en `design/prototipo/`: 4 páginas (Sistema base, Partida, Pantallas y Estados transversales) con 51 artboards, que se abren con `npx serve design/prototipo`. Criterios comprobados:
- [x] Guía de estilo en `docs/diseno.md`: principios, tokens con los contrastes medidos, tipografía, geometría, componentes y sus estados, prioridad de estados de la celda, accesibilidad, responsive y estados transversales.
- [x] Revisión de originalidad en `docs/diseno.md` («Revisión de originalidad (T-18.1)»): nada replica la interfaz de la referencia.

Además: pantallas y flujos en `design/pantallas.md`, entrega a F8 (decisiones, prioridades, pendientes y lista de comprobación) en `design/entrega-f8.md` y registro de fotos en `design/fotos.md`. Las correcciones al prototipo decididas al cerrar F7 se aplican en F8, no en el HTML.

### F8 — Cliente con servidor local simulado (4–8 h; original 15–25 h)
**Tareas:**
- `apps/web` implementando el diseño de F7.
- El cliente se comunica mediante la interfaz `Transport`. Para desarrollo, se usa un servidor simulado en memoria; solo en ese modo existe la solución en el navegador.
- Funcionalidad: tablero, entrada de números, notas por capas con selector de vista y de escritura, vidas, temporizador y ajustes.

**Criterios de aceptación:**
- Una partida completa en modo de un jugador simulado funciona.
- Pruebas de componentes en verde.
- La versión de producción no incluye el servidor simulado (verificado en el build).

**Al aprobar el plan, el usuario pidió:**
- push y CI en verde en cada subtarea;
- en el cliente de producción, solo el protocolo, i18n, React, la geometría y las máscaras del motor y `@sudoku-killer/game/client`, verificado por `check-dist` (ante un falso positivo se corrigen los imports, nunca el detector);
- el hash con `crypto.subtle` igual al de `node:crypto`;
- `pnpm dev` en localhost y `pnpm dev:lan` solo para la red de casa;
- el manifiesto importado solo en desarrollo;
- la prioridad 3 y los pendientes de `entrega-f8.md` §4, a F10.

**Subtareas:**

| Subtarea | Contenido | Estado |
|---|---|---|
| F8a | Protocolo v1 completo (`packages/protocol/src/v1/`) y pruebas de esquema (T-07.1 en su parte de esquema, T-10.2, T-16.1, T-25.6 y T-34.1). | Hecha |
| F8b | `packages/bank` (dificultad, regeneración y forma canónica, que antes estaban en el servidor) y `packages/game` definitivo: `decide`, `apply`, `replay`, `project` y `createNormalMode`, con T-15.1 y la base de T-32.1. | Hecha |
| F8c | `Transport`, servidor simulado (`apps/web/src/dev/sim/`), núcleo del cliente, T-31.2 con `check-dist` y una partida completa automatizada hasta la victoria. | Hecha |
| F8d | Pantalla de partida (prioridades 1 y 2), tokens, fuentes locales, atajos y pruebas de componentes (T-04.3, T-06.1, T-07.2, T-24.3, T-25.2, T-28.2 y T-33.1). | Hecha |
| F8e | Punto de control en PC y celular, con siete correcciones. | Hecha |
| F8f | Bot compañero (`?bot=N&pace=&errors=&seed=`), que juega por el protocolo sin ver la solución. | Hecha |
| F8g | Correcciones de la prueba con el bot y cierre. | Hecha |

**Estado:** hecha el 2026-10-24, en unas 3,4 h, frente a 4–8 h. El plan de F8 estimaba 6–10 h porque el protocolo y `packages/game` estaban vacíos. Las horas no incluyen las pruebas del usuario en PC, celular y tablet.
- **Decisiones de las pruebas del usuario** (en `docs/diseno.md` y en la SPEC):
  - «Usar notas» es una preferencia local (`localStorage`), sin cambio de protocolo (R-06, T-06.3);
  - la actividad ocupa una línea, con el historial a pedido en «Ver actividad»;
  - las jaulas pasan a 2 px y la seleccionada a 3 px, porque Chromium dibuja los grosores fraccionarios redondeados hacia abajo;
  - el dígito pendiente se dibuja en el mismo ciclo del evento, aun con latencia;
  - si el arranque falla o no termina en 15 s, el inicio muestra un aviso con «Reintentar» (R-37, T-37.1);
  - el Inicio tiene un enlace al repositorio con la marca de GitHub.
- **Arreglo de la red local:** por `http://<IP>` la página no es un contexto seguro, y el navegador no expone `crypto.randomUUID` ni `crypto.subtle`. Los identificadores salen de `crypto.getRandomValues`. El simulador usa un SHA-256 en JavaScript (solo en desarrollo) y no omite la comprobación del hash.
- **Tiempos de carga del simulador:** `docs/dificultad.md` §5.1. La carga más lenta medida es de unos 280 ms, así que no hace falta un Worker.
- **Desviaciones registradas:**
  - `packages/engine` suma el punto de entrada `./model` (`src/model.ts`), que solo reexporta la geometría, las máscaras y la limpieza de notas, para que el cliente no arrastre el calificador. No hay lógica nueva, y el corpus siguió en verde.
  - Hay un paquete nuevo, `packages/bank`, con lo puro del banco que antes estaba en `apps/server`.
  - Las pruebas de esquema, T-15.1 y la base de T-32.1 se adelantaron de F9 a F8 (SPEC 1.6).
  - El evento `cell.solved` guarda `level` y `graderVersion`, y cada jugador de `match.started` y `player.joined` lleva su `connection` (ADR 0004, nota de F8).
  - La prueba de humo en WebKit (iPhone y iPad por la IP de la red local) se corrió fuera del repositorio. Las pruebas E2E con Playwright siguen en F11.
  - Se llevaron a F10 la prioridad 3, los estados de red, la decisión 3 y los pendientes de `entrega-f8.md` §4. El tema oscuro quedó fuera de la v1 (`docs/IDEAS_FUTURAS.md`).

### F9 — Servidor de salas (3–6 h; original 15–25 h)
**Tareas:**
- Creación y unión a salas por código, con apodos únicos.
- Ciclo de vida completo según la sección 2.
- Fichas de reconexión aleatorias de 128 bits.
- Plazo de gracia de 2 minutos.
- Registro de eventos persistido.
- Validación de todos los mensajes con Zod.
- Límite de velocidad de mensajes por conexión.
- Implementación del modo Normal como módulo `GameMode`.
- Pistas compartidas, deshacer de notas con comprobación, presencia, y vuelta con ficha tras salir o expirar (SPEC R-19, R-24 a R-27).
- Heartbeat, `maxPayload` y control de saturación (ADR 0002).
- Confirmación en la base de datos antes de difundir y reconstrucción de las partidas en curso tras un reinicio (ADR 0003 y 0004).
- Banco de puzzles (heredado de F5, ADR 0006):
  - driver de PostgreSQL y comando `bank:load` con `DATABASE_URL`, que aplica las migraciones y llama a `loadBank`;
  - comprobación al arrancar de que hay puzzles de cada dificultad;
  - elección al azar sin repetir (R-21, T-21.1 y T-21.2) en `PuzzleRepository`.

**Criterios de aceptación:**
- Pruebas de cada transición de estado y de cada caso límite de la SPEC.
- El test de "la solución nunca sale del servidor" está en verde.

**Al aprobar el plan, el usuario pidió:**
- PostgreSQL 18 local en desarrollo, con un rol propio sin privilegios, dueño solo de la base `sudoku_killer` (nunca `postgres`). El usuario ejecuta el SQL en «SQL Shell (psql)», elige la contraseña y escribe `apps/server/.env`. Ningún script ni log muestra `DATABASE_URL`, y las pruebas siguen con PGlite en memoria.
- Los puzzles que salen del manifiesto se retiran, no se borran, y las partidas viejas conservan su clave foránea.
- Un punto de control del esquema de `matches` y `match_events` antes de implementar la persistencia.
- Fichas de 128 bits con `node:crypto`, de las que solo se guarda el SHA-256; secretos solo por variables de entorno; Zod en todo mensaje entrante; errores sin detalles internos; lista de orígenes permitidos.
- Una demostración con el servidor real y dos clientes Node hasta la victoria.

**Subtareas** (la estimación del plan aprobado es de unas 6–7 h, por encima de las 3–6 h de la fase, por la persistencia, la reconstrucción, el adaptador `ws` y la demostración):

| Subtarea | Contenido | Estado |
|---|---|---|
| F9a | Piezas puras en sus paquetes: apodo y código de sala en `packages/protocol` (T-09.3); código, asientos, traspaso y snapshot del lobby en `packages/game` (T-09.4); esquema Zod de los eventos; `pickPuzzle` en `packages/bank` (T-21.2). El simulador y el Inicio las usan. | Hecha |
| F9b | Núcleo del servidor: interfaces de §8.2, `RoomStore`, cola por sala, lobby, ciclo de vida, fichas, plazos, E-08, inspector de filtración y logger. | Hecha |
| F9c | Partida en vivo, presencia, idempotencia, límites de velocidad y T-32.1 contra el servidor. | Hecha |
| F9d | Punto de control (esquema aprobado por el usuario) y después persistencia: `matches` y `match_events`, group commit, reconstrucción, E-16 y retiro de puzzles. | Hecha |
| F9e | Base local configurada con el script aprobado por el usuario (`db:setup-local`) y producción: `ws`, `pg`, configuración, `db:migrate` y `bank:load`. | Hecha |
| F9f | Demostración y cierre. | Pendiente |

### F10 — Integración en tiempo real (5–10 h; antes 4–8 h; original 15–25 h)
**Tareas:**
- Conectar el cliente al servidor real.
- Actualizaciones optimistas con reconciliación por número de secuencia.
- Sincronización del reloj mediante ping.
- Notificaciones de jugadas correctas y erróneas.
- Puntos en vivo.
- Notas grupales con operaciones ordenadas.
- Notas personales guardadas en el servidor para que sobrevivan a una reconexión.
- Reconexión transparente para el jugador.

- **Prioridad 3 completa de `design/entrega-f8.md` y estados de red** (sumada al cerrar F8, plan 1.18):
  - las pantallas Inicio, Entrar o crear, Lobby, Resultados y Ayuda;
  - los estados de red: reconectando, servidor no disponible, sesión en otra pestaña, versión incompatible, demasiadas acciones, acción no permitida, no se pudo deshacer y se recuperaron X de Y notas;
  - la decisión 3: «Volver a la sala» lleva al lobby, a la partida o a resultados según el estado de la sala;
  - los pendientes de `entrega-f8.md` §4: las fotos con su fuente y licencia en `design/fotos.md`, las pantallas fuera de la partida entre 600 y 1023 px, el comportamiento de «Compartir» en el lobby y las transiciones no dibujadas, incluida la vuelta con ficha a una sala llena.
  - El inicio mínimo de F8 (apodo y dificultad, con el enlace al repositorio y el aviso con «Reintentar») se reemplaza por el Inicio completo, que conserva las dos cosas.

**Criterios de aceptación:**
- 6 pestañas jugando una partida completa.
- Clics simultáneos en la misma celda resueltos según la regla.
- Desconexión y vuelta dentro del plazo sin pérdida de estado.
- Cada pantalla de la prioridad 3 y cada estado de red se ven con sus estados a 360 y a 1280 px, sin desplazamiento horizontal, y los pendientes de `entrega-f8.md` §4 quedan resueltos o decididos por el usuario. «Volver a la sala» cumple la decisión 3.

### F11 — Pruebas integrales, carga y seguridad (3–6 h; original 10–16 h)
**Tareas:**
- Pruebas E2E con Playwright para los flujos principales y los casos límite.
- Pruebas de caos: cortes de red aleatorios.
- Prueba de carga: al menos 50 salas simultáneas en una instancia, midiendo latencia p95 y memoria.
- Revisión de seguridad: validación de mensajes, límites de velocidad, filtración de datos.
- Primera recalibración de la puntuación con partidas internas.

**Criterios de aceptación:**
- Latencia p95 de jugada menor a 150 ms en la prueba de carga.
- 0 fallos E2E.
- Hallazgos documentados.

### F12 — Despliegue privado (2–4 h; original 5–10 h)
**Tareas:**
- Hosting elegido por ADR.
- HTTPS y WSS.
- Base de datos gestionada y respaldos.
- Variables de entorno.
- Clave de acceso del grupo cerrado (opcional, recomendada).
- Logs y métricas básicas.
- Revisar las migraciones automáticas al arrancar (F9): en producción, una migración destructiva no debe aplicarse sola.

**Criterios de aceptación:**
- Una partida real entre dispositivos distintos funciona.
- Restaurar un respaldo funciona.

### F13 — Beta cerrada y cierre de la v1 (10 h, más 1–2 semanas de calendario; original 10–20 h)
**Tareas:**
- Partidas con el grupo cerrado.
- Formulario de retroalimentación.
- Análisis de registros de partidas.
- Recalibración final de la puntuación y de la dificultad.
- Corrección de errores.
- Etiqueta `v1.0.0`.

**Criterios de aceptación:**
- Ningún error crítico abierto.
- Parámetros de puntuación finales justificados en `docs/puntuacion.md`.
- `IDEAS_FUTURAS.md` priorizado para la v2.

---

## 7. Riesgos principales

| Riesgo | Mitigación |
|---|---|
| El calificador humano es complejo y retrasa F4 | Empezar con los niveles 1 a 3; los niveles superiores se agregan de forma incremental. |
| La puntuación premia la velocidad sobre la habilidad | Pesos por nivel de deducción y simulación con bots en F6. |
| Desincronización entre clientes | Servidor autoritativo, números de secuencia y reconstrucción desde el registro de eventos. |
| Estimaciones optimistas | Registrar horas reales y recalibrar el plan al cerrar cada fase. |
| `CONTEXTO.md` crece y consume contexto | Límite de unas 120 líneas; el historial va en `BITACORA.md`. |

---

## 8. Registro de cambios del plan

- **1.01:** versión inicial. Modo Normal para la v1 y modo competitivo movido a ideas futuras. Reglas de sala, notas y puntuación definidas. Diseño propio obligatorio en F7.
- **1.02:** Referencia de skill corregida a la oficial de REA.
- **1.03:** F1 marcada como hecha (~0,6 h reales). F2 suma la pregunta abierta sobre las pistas en la v1 (si existen, cuántas, si son individuales o compartidas y si afectan la puntuación). F6 suma, en la simulación Monte Carlo, un modelo de comparación basado en velocidad como el de la app de referencia (ver `docs/referencia.md`, sección 12). Hay que demostrar que el modelo propio reduce la ventaja de correr por celdas fáciles.
- **1.04:** F2 marcada como hecha (~0,4 h reales). Cambios:
  - La sección 15 de `referencia.md` se descartó.
  - Se agregó el paquete `packages/game` (reductor puro y `GameMode`, ADR 0004).
  - El stack quedó confirmado por los ADR 0001 y 0002: `ws` con protocolo propio.
  - F3 suma una regla de lint contra el uso del reloj y del azar en los paquetes puros.
  - F4 aclara cuándo hay números iniciales y agrega `cleanupPeers`.
  - F6 agrega el parámetro H (costo de una pista) y las pistas en la simulación.
  - F9 suma pistas, deshacer con comprobación, presencia, vuelta con ficha, heartbeat y saturación, y la reconstrucción tras un reinicio.
- **1.05:** F3 marcada como hecha (~0,3 h reales). La SPEC pasa a la versión 1.1: R-05 explica las jugadas simultáneas (gana la primera que procesa la cola; si la primera es un error, la celda no se bloquea) y suma T-05.5. TypeScript se fija en 6.0.x por compatibilidad con `typescript-eslint` (ADR 0001).
- **1.06:** F4 se divide en las subfases F4a–F4f (aprobadas por el usuario). La SPEC pasa a la versión 1.2 con R-35 (pruebas del motor). F4a hecha (~0,3 h, incluida la planificación de F4).
- **1.07:** F4b (~0,6 h) y F4c (~1,1 h) hechas. F4 registra la desviación de los puzzles de referencia (construidos, sin fuente pública) y una nota para F4d pedida por el usuario: presupuesto de nodos o de tiempo para `solveA` en el generador, con descarte de candidatos y medición de cuántos se descartan.
- **1.08:** refuerzo de F4c pedido por el usuario antes de F4d: B con poda contra Dancing Links puro (0 diferencias) y semillas visibles en las pruebas aleatorias, con regresiones fijas (`docs/motor.md`).
- **1.09:** F4d hecha (~0,4 h): generador, presupuesto de nodos en `solveA`, corpus de 1000 puzzles (0 discrepancias) y workflow programado.
- **1.10:** F4e hecha (~0,4 h): calificador de niveles 1 a 3 y `levelToDeduce`, con los requisitos del usuario registrados en F4. Corpus: 0 deducciones erróneas; el 23 % de los puzzles excede los niveles 1 a 3.
- **1.11:** F4f hecha (~0,5 h) y **F4 cerrada** (~3,4 h reales frente a 20–35 h estimadas). Cambios:
  - Calificador de niveles 4 y 5 con el pedido del usuario registrado en F4. Corpus: 0 deducciones erróneas y el 7 % de los puzzles excede todas las técnicas. `levelToDeduce`: p95 de 9,2 ms.
  - F5 suma los datos de partida del corpus y dos decisiones pendientes: excluir del banco los puzzles que exceden las técnicas, y cómo compensar el rendimiento bajo del nivel fácil (decisión P2).
  - La sección 5 suma una recalibración propuesta de F5 a F13 (de 96–171 h a 28–57 h), pendiente de aprobación. La tabla mantiene las estimaciones originales hasta entonces.
  - Después del cierre, aprobado por el usuario (2026-10-23): la recalibración, con un cambio (F7 y F13 en 10 h cada una). F5 a F13 pasan de 96–171 h a 40–61 h y el total de la v1 queda en unas 45–66 h. Se actualizaron la tabla de la sección 5 y los encabezados de F5 a F13.
  - Decisiones de F5 aprobadas: los puzzles que exceden todas las técnicas se excluyen del banco; el fácil se obtiene generando más y filtrando (`easyGivens` solo si la prueba manual muestra que resulta difícil; las jaulas más chicas quedan descartadas); la equivalencia entre niveles y dificultades se decide en F5 con el informe del calificador (`docs/motor.md`).
  - Sección 1: la frase de jugadas simultáneas coincide con R-05 (si la primera jugada es un error, la celda sigue libre).
- **1.12:** F7 hecha (~1,5 h reales frente a 10 h aprobadas). Prototipo importado en `design/prototipo/` (4 páginas, 51 artboards), guía de estilo con la revisión de originalidad (T-18.1) en `docs/diseno.md` y documentos de entrega en `design/`. Siete correcciones al prototipo quedan decididas para F8 (`design/entrega-f8.md`). La tabla de la sección 5 conserva la estimación aprobada; la diferencia de F7 entra en la próxima comparación, al cerrar F5.
- **1.13:** F5 hecha (~1,2 h reales frente a 2–4 h).
  - `unitCombination` acotada a 4/8 (`GRADER_VERSION` "2") y equivalencia de dificultades versión 1, las dos aprobadas por el usuario en el punto de control de F5a.
  - Banco de 2000 puzzles versionado como manifiesto de semillas (ADR 0006).
  - Tabla `puzzles` con Drizzle, `PuzzleRepository` y `loadBank`, con pruebas con PGlite.
  - SPEC 1.3: T-20.3 a T-20.5 y `PuzzleRecord` con `graderVersion` y `seed`.
  - La prueba manual se hace en papel con una muestra imprimible; la prueba con varios jugadores en tiempo real queda para F8 y F13 (desviación registrada).
  - F9 hereda la carga contra PostgreSQL y la elección de puzzles.
  - Comparación de horas en la sección 5: la recalibración se mantiene.
- **1.14:** números iniciales escalonados por dificultad, aprobados tras la prueba en papel de F5, que reemplazan la decisión b).
  - Equivalencia versión 2: 30, 22, 10 y 0 números, con bandas de nivel 1, 2, 3–4 y 5 que no se solapan.
  - `addGivens` con guarda, repartido por cajas; una dificultad por semilla; `GENERATOR_VERSION` "2".
  - Manifiesto regenerado; SPEC 1.4; F5 suma unas 0,8 h (unas 2,0 h en total).
- **1.15:** F6 hecha (~2,2 h reales frente a 2–5 h).
  - Parámetros v1: B = 10, w = 1/2/3/4/5, P = 90, β = 1 y H = 60, con el nivel calculado con los descartes públicos de los errores.
  - Las metas de F6 se cambiaron en el punto de control, por decisión del usuario. La de equidad (cuota de puntaje frente a cuota de aporte, entre veloz y lógico) reemplaza a la del 55 %, y el Spearman se mide contra el techo de confiabilidad.
  - Las brechas que quedan son limitaciones conocidas, que se recalibran en F11 y F13 con partidas reales.
  - SPEC 1.5 (§2.3, §5, T-19.6, T-35.7, T-35.8 y R-36) y `docs/puntuacion.md`.
- **1.16:** la memoria del proyecto pasa a `CONTEXTO.md` y se actualizan sus referencias. La sección 4 pasa a llamarse «Protocolo de trabajo» y su redacción, como la de la sección 5 y la de F0, queda neutra respecto de las herramientas. La CI suma el job `attribution-guard`.
- **1.17:** historial reescrito y repositorio recreado. Los 38 commits conservan autor, fecha y árbol final, con otros identificadores; la revisión de secretos no encontró ninguno real. No cambia el alcance ni las estimaciones de las fases.
- **1.18:** F8 hecha (~3,4 h reales frente a 4–8 h).
  - Protocolo v1 completo, `packages/bank`, `packages/game` definitivo, servidor simulado solo para desarrollo (verificado sobre el build con `check-dist`), pantalla de partida con las prioridades 1 y 2 y bot compañero.
  - Decisiones de las pruebas del usuario: «Usar notas» como preferencia local, la actividad en una línea con el historial a pedido, el grosor de las jaulas, el dígito pendiente inmediato, el aviso con «Reintentar» y el enlace a GitHub en el Inicio.
  - Desviación: el punto de entrada `./model` de `packages/engine`, sin lógica nueva.
  - F10 suma la prioridad 3 completa de `entrega-f8.md`, los estados de red, la decisión 3 y los pendientes de su §4, con su criterio de aceptación. Pasa de 4–8 h a 5–10 h, y el total de la v1 queda en unas 46–68 h.
  - El tema oscuro va a `docs/IDEAS_FUTURAS.md`.
  - SPEC 1.6; ADR 0001 (i18n propio) y ADR 0004 (forma definitiva de los eventos), con notas de F8.
