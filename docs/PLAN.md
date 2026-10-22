# PLAN — Sudoku Killer Multijugador · v1

Versión del plan: 1.04
Estado global: F0 hecha (2026-10-22) · F1 hecha (2026-10-22) · F2 hecha (2026-10-22) · F3 pendiente
Fuente de verdad del proyecto. Se actualiza al terminar cada fase o cuando se detecte un error de planificación (ver "Mantenimiento del plan").

---

## 1. Visión de la v1

Sudoku killer web en el que hasta 6 personas, identificadas solo con un apodo, se unen a una sala mediante un código y resuelven el mismo tablero en tiempo real, como si estuvieran sentadas alrededor de una mesa.

### Modo Normal (único modo de la v1)
- **Resultado grupal:** el equipo gana si completa el tablero y pierde si todos los jugadores quedan como espectadores.
- **Ranking individual de aporte:** gana el ranking quien más puntos suma.
- **Vidas:** cada jugador tiene 3. Al llegar a 0 pasa a espectador y conserva sus puntos.
- **Jugadas visibles para todos:** cada jugada correcta o errónea se notifica a todos indicando quién la hizo. La celda correcta queda bloqueada. El número erróneo se muestra un instante y luego se retira.
- **Jugadas simultáneas** en la misma celda: gana la primera que llega al servidor. La segunda recibe "ya resuelta" y no se penaliza.
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
4. **Antes de cada `/clear`:**
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

Las horas son de trabajo efectivo de una persona, incluyendo revisión y pruebas, con un margen de ±40 %.

| Fase | Nombre | Horas estimadas | Depende de | Estado | Horas reales |
|---|---|---|---|---|---|
| F0 | Entorno y arranque | 2–4 | — | Hecha | ~0,1 |
| F1 | Estudio de referencia con REA | 3–6 | F0 | Hecha | ~0,6 |
| F2 | Especificación y arquitectura | 6–10 | F1 | Hecha | ~0,4 |
| F3 | Monorepo y calidad | 3–5 | F2 | Pendiente | |
| F4 | Motor del puzzle | 20–35 | F3 | Pendiente | |
| F5 | Banco de puzzles y dificultad | 6–12 | F4 | Pendiente | |
| F6 | Sistema de puntuación | 10–18 | F4 | Pendiente | |
| F7 | Diseño visual propio | 10–20 | F2 (puede ir en paralelo con F4–F6) | Pendiente | |
| F8 | Cliente con servidor local simulado | 15–25 | F4, F7 | Pendiente | |
| F9 | Servidor de salas | 15–25 | F3, F5, F6 | Pendiente | |
| F10 | Integración en tiempo real | 15–25 | F8, F9 | Pendiente | |
| F11 | Pruebas integrales, carga y seguridad | 10–16 | F10 | Pendiente | |
| F12 | Despliegue privado | 5–10 | F11 | Pendiente | |
| F13 | Beta cerrada y cierre de la v1 | 10–20 (+1–2 semanas de calendario) | F12 | Pendiente | |
| **Total** | | **130–230 h** | | | |

Equivale a unas **7–15 semanas** dedicando 15–20 horas por semana. Si otra persona trabaja F7 en paralelo, el total se reduce entre 1 y 2 semanas.

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
  5. Si tiene más de una, ajustar jaulas o agregar un número inicial, y volver a verificar. Solo hay números iniciales cuando hacen falta para la unicidad o en el nivel fácil; cada puzzle registra el motivo en `givensReason` (SPEC R-20).
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

**Criterios de aceptación:**
- 0 discrepancias entre solvers.
- 100 % de los puzzles con solución única.
- Tiempo medio de generación medido y documentado.

### F5 — Banco de puzzles y calibración de dificultad (6–12 h)
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

### F6 — Sistema de puntuación (10–18 h)
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

### F7 — Diseño visual propio (10–20 h)
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

### F8 — Cliente con servidor local simulado (15–25 h)
**Tareas:**
- `apps/web` implementando el diseño de F7.
- El cliente se comunica mediante la interfaz `Transport`. Para desarrollo, se usa un servidor simulado en memoria; solo en ese modo existe la solución en el navegador.
- Funcionalidad: tablero, entrada de números, notas por capas con selector de vista y de escritura, vidas, temporizador y ajustes.

**Criterios de aceptación:**
- Una partida completa en modo de un jugador simulado funciona.
- Pruebas de componentes en verde.
- La versión de producción no incluye el servidor simulado (verificado en el build).

### F9 — Servidor de salas (15–25 h)
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

**Criterios de aceptación:**
- Pruebas de cada transición de estado y de cada caso límite de la SPEC.
- El test de "la solución nunca sale del servidor" está en verde.

### F10 — Integración en tiempo real (15–25 h)
**Tareas:**
- Conectar el cliente al servidor real.
- Actualizaciones optimistas con reconciliación por número de secuencia.
- Sincronización del reloj mediante ping.
- Notificaciones de jugadas correctas y erróneas.
- Puntos en vivo.
- Notas grupales con operaciones ordenadas.
- Notas personales guardadas en el servidor para que sobrevivan a una reconexión.
- Reconexión transparente para el jugador.

**Criterios de aceptación:**
- 6 pestañas jugando una partida completa.
- Clics simultáneos en la misma celda resueltos según la regla.
- Desconexión y vuelta dentro del plazo sin pérdida de estado.

### F11 — Pruebas integrales, carga y seguridad (10–16 h)
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

### F12 — Despliegue privado (5–10 h)
**Tareas:**
- Hosting elegido por ADR.
- HTTPS y WSS.
- Base de datos gestionada y respaldos.
- Variables de entorno.
- Clave de acceso del grupo cerrado (opcional, recomendada).
- Logs y métricas básicas.

**Criterios de aceptación:**
- Una partida real entre dispositivos distintos funciona.
- Restaurar un respaldo funciona.

### F13 — Beta cerrada y cierre de la v1 (10–20 h, más 1–2 semanas de calendario)
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