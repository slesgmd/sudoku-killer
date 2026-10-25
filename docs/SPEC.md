# SPEC — Sudoku Killer Multijugador · v1

- Versión del documento: 1.12 (F12, 2026-10-25). Cambios desde la 1.0 (F2): R-05 precisa las jugadas simultáneas y suma T-05.5 (1.1); R-35 fija las pruebas del motor del puzzle (1.2); R-20 suma el banco de puzzles (T-20.3 a T-20.5) y `PuzzleRecord` guarda `graderVersion` y `seed` (1.3); P2 y R-20 escalonan los números iniciales por dificultad y `givensReason` cambia `easy` por `difficulty` (1.4); F6 fija B, w, P, β y H, el nivel se calcula con los descartes públicos de los errores (§2.3 y §5), R-35 suma T-35.7 y T-35.8 y la nueva R-36 reúne las pruebas de la puntuación (1.5); F8 fija el destello en 1500 ms (§1.4 y T-04.3), el evento `cell.solved` guarda `level` y `graderVersion` (§5), T-31.2 describe su detector, las pruebas de esquema, T-15.1 y la base de T-32.1 se adelantan a F8, R-06 suma la preferencia local «Usar notas» (T-06.3) y la nueva R-37 cubre el arranque que falla (1.6); F9 fija las cubetas de presencia y de ping, los cierres 4002 y 1012, el 403 por origen, el apodo en grafemas, la persistencia de §2.5 y el registro de las desconexiones al reconstruir (1.7); F10 suma `defeatCause`, opcional, a `match.ended` y al snapshot (§4.3, §4.5, T-01.6 y T-01.7), y la nueva R-38 cubre la actividad tras una reconexión (1.8); F11 suma a §4.8 los topes de conexiones y de salas por instancia (`docs/seguridad.md`, S-01) y registra que la prueba de carga confirmó los valores iniciales (1.9); F12 suma la clave de acceso del grupo en el handshake (R-39, cierre 4003, espera por IP y `sk:access`), el tope de conexiones por IP, los plazos del HTTP y el servidor dormido en R-37 (1.10); tras el primer despliegue, solo una clave ofrecida que no vale cuenta para la espera por IP, una IP que no se puede saber no comparte espera ni tope, el 429 lleva `Retry-After`, `GET /ws` dice qué recibiría el handshake y el cliente distingue un handshake rechazado del servidor dormido (T-39.7 a T-39.10, 1.11); el 4003 se envía en respuesta al primer mensaje del cliente, porque detrás del proxy de Render el que salía junto con el 101 no llegaba (T-39.11, 1.12). El protocolo sigue en la versión 1: un campo opcional es un cambio compatible (§4.7).
- Versión del protocolo: **1**
- Fuente de las reglas: `docs/PLAN.md`, secciones 1 y 2, más las decisiones de producto de F2 (sección 1 de este documento).
- Decisiones técnicas: `docs/adr/0001`–`0007`.

## 0. Cómo leer este documento

| Prefijo | Significado |
|---|---|
| **P-n / D-n** | Decisión de producto tomada en F2 (sección 1). |
| **R-nn** | Regla verificable (sección 6). |
| **T-nn.m** | Caso de prueba de la regla R-nn, escrito como *Dado / Cuando / Entonces*. |
| **E-nn** | Caso límite (sección 7). Cada uno remite a sus T. |

Los nombres de tipos, mensajes y campos están en inglés, porque son código. Las explicaciones están en español. "Debe" indica una obligación verificable.

---

## 1. Alcance y decisiones de producto

### 1.1 Modo Normal (único modo de la v1)
Resumen de `PLAN.md` §1 y §2. Las reglas detalladas están en la sección 6.

- Juego cooperativo: el equipo gana al completar el tablero.
- Ranking individual por puntos.
- 3 vidas por jugador; al llegar a 0, el jugador pasa a espectador.
- Jugadas visibles para todos. Si dos jugadas llegan a la misma celda, gana la primera que llega al servidor.
- Notas personales y grupales.
- Temporizador común que no se pausa.

### 1.2 Decisiones de producto de F2 (ronda única con el usuario, 2026-10-22)

| ID | Decisión | Regla |
|---|---|---|
| P1 | **Pistas compartidas por el equipo: 3 por partida.**<br>• Las usa un jugador activo sobre una celda vacía que él elige. El servidor coloca el valor correcto y bloquea la celda.<br>• No da bonus de cierre a nadie, no cuesta vidas y se avisa a todos quién la usó.<br>• **Le cuesta −H puntos a quien la usa** (H = 60, fijado en F6: `docs/puntuacion.md`). Así no sirve para quitarles celdas difíciles a otros jugadores. | R-19 |
| P2 | Jaulas de 2 a 5 celdas; no hay jaulas de 1 celda. Los números iniciales se escalonan por dificultad: 30 en fácil, 22 en media, 10 en difícil y ninguno en experto, además de los que el generador necesite para que la solución sea única. Cambio aprobado en F5 (2026-10-23) tras la prueba en papel; antes solo había números iniciales en el fácil o por unicidad. | R-20 |
| P3 | 4 niveles: fácil, media, difícil y experto. Los elige quien puede iniciar, antes de cada partida. | R-21 |
| P4 | Al terminar, la sala vuelve al lobby y la partida siguiente empieza con todos activos (3 vidas, 0 puntos). El ranking es por partida; no hay ranking acumulado. | R-22 |
| P5 | Los espectadores ven todo y pueden escribir notas grupales y personales. No colocan números ni usan pistas. | R-23 |
| P6 | Cada jugador ve qué celda tiene seleccionada cada compañero. La presencia no se guarda en el registro de eventos. | R-24 |
| P7 | Deshacer funciona solo sobre las acciones de notas del propio jugador, mediante la operación inversa. **Deshacer una operación grupal solo se aplica si el estado sigue siendo el que dejó esa operación**; si no, no hace nada y avisa. Las jugadas de números no se deshacen. | R-25 |
| P8 | No hay chat en la v1. | — |
| P9 | No hay límite de tiempo: el cronómetro cuenta hacia arriba. | R-07 |
| D1 | Se puede iniciar con 1 jugador. | R-30 |
| D2 | El código de sala tiene 6 caracteres del alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, sin 0, O, 1, I ni L.<br>El apodo tiene de 2 a 16 caracteres (grafemas, como los ve una persona, después de NFKC y de recortar los espacios) y es único en la sala, sin distinguir mayúsculas.<br>**El apodo de un jugador con ficha queda reservado hasta que termina la partida**, aunque haya salido o expirado, porque sigue en el ranking. Se libera al terminar la partida. Fuera de una partida, se libera al salir o al expirar. | R-09, R-27 |
| D3 | Quien sale a propósito libera su asiento al instante. Si vuelve a la misma partida con su ficha, recupera vidas, puntos y notas, siempre que haya cupo. Si tenía 0 vidas, vuelve como espectador. **Nunca entra como jugador nuevo con 3 vidas.**<br>Limitación aceptada para un grupo cerrado: borrar los datos del navegador borra la ficha y evita esta regla. | R-26 |
| D3' | Lo mismo se aplica a quien **expiró**, es decir, quien superó los 2 minutos de desconexión. El plazo de 2 minutos solo garantiza el asiento; pasado ese plazo, el jugador vuelve si hay cupo. Si no fuera así, bastaría con desconectarse 2 minutos para recuperar las vidas. | R-13, R-26 |
| D4 | Si no queda ningún jugador **activo**, la partida termina en derrota. Cuentan como activos los conectados y los desconectados que siguen dentro del plazo de gracia. | R-01 |
| D5 | La limpieza automática de las notas personales viene activada por defecto. | R-17 |
| D6 | Un número que repite el dígito de una celda bloqueada en su fila, columna, caja o jaula se puede escribir: el cliente no lo impide y cuenta como error. En cambio, escribir sobre una celda ya bloqueada no es posible y no penaliza (R-05). | R-28, R-05 |
| D7 | Las notas personales solo las ve su dueño. | R-29 |
| D8 | No hay "segunda oportunidad" ni pausa. | R-34 |
| D9 | El puzzle se elige al azar del banco, dentro de la dificultad, sin repetir los que ya se jugaron en la sala. | R-21 |
| D10 | Se resalta la jaula de la celda seleccionada. El diseño se define en F7. | R-33 |
| D11 | Un espectador no vuelve a ser activo en la misma partida. | R-23 |

### 1.3 Fuera de la v1
Estas ideas están registradas en `docs/IDEAS_FUTURAS.md`:
- Modo competitivo.
- Ranking acumulado de la sala.
- Chat y reacciones.
- Contrarreloj.
- Identidad persistente, que sobreviva al borrado del navegador.

### 1.4 Preguntas abiertas: resolución y dueño
Incluye las 14 preguntas de `docs/referencia.md` y la pregunta de pistas de `PLAN.md`. Ninguna queda sin dueño.

| # | Pregunta | Resolución | Dueño |
|---|---|---|---|
| ref-1 | Respuesta real de `/api/level` | No aplica: los puzzles se generan en F4 y F5. | Cerrada |
| ref-2 | Notas en ejecución | No aplica: las reglas propias son R-16 y R-17. | Cerrada |
| ref-3 | ¿La limpieza se dispara con un número incorrecto? | No. Solo se dispara al bloquear una celda (R-17, T-17.3). | Cerrada |
| ref-4 | ¿Se puede desactivar la limpieza? | En las notas personales, sí (ajuste). En las grupales, no (R-17). | Cerrada |
| ref-5 | Resaltado de la jaula seleccionada | Sí (D10). | F7 (diseño), F8 (implementación) |
| ref-6 | Deshacer | Solo notas, con comprobación (R-25). | Cerrada |
| ref-7 | ¿Se puede borrar o sobrescribir un número correcto? | No: la celda queda bloqueada para siempre (R-15). | Cerrada |
| ref-8 | Pista en ejecución | R-19. H = 60 (F6, `docs/puntuacion.md`). | Cerrada |
| ref-9 | Pausa | No hay pausa (R-07, R-34). | Cerrada |
| ref-10 | Segunda oportunidad | No hay (D8). | Cerrada |
| ref-11 | `checkMistakes` | No aplica: todo error cuenta (R-03). | Cerrada |
| ref-12 | Multiplicador por completar áreas | No aplica: usamos el bonus β = 1 por unidad cerrada (F6). | Cerrada |
| ref-13 | ¿El temporizador sigue con la pestaña oculta? | El tiempo lo lleva el servidor y no se pausa (R-07). | Cerrada |
| ref-14 | Cambio de dificultad en ejecución | No aplica: la dificultad se elige en el lobby (R-21). | Cerrada |
| plan | Pistas en la v1 | P1 y R-19, con H = 60 (F6). | Cerrada |

Parámetros que quedan pendientes con su dueño:
- B, w, P, β y H: **resueltos en F6** (`docs/puntuacion.md`, `packages/scoring/src/params.v1.json`): B = 10, w = 1, 2, 3, 4 y 5 para los niveles 1 a 5, P = 90, β = 1 y H = 60. Se recalibran con registros de partidas reales en F11 y F13.
- Mapeo de los niveles del calificador a las dificultades: **resuelto en F5** (`docs/dificultad.md`, versión 2, con números iniciales por dificultad). Se recalibra con la segunda muestra impresa de F5 y con partidas reales en F13.
- Límites de velocidad y de tamaño de mensaje: valores iniciales en la sección 4.8; se calibran en F11.
- Duración del destello de un error: **resuelta en F7 y F8**: 1500 ms (`--t-error-flash`, T-04.3).
- Hosting: F12.

---

## 2. Modelo de datos

### 2.1 Tablero
- **Tamaño:** se parametriza como `size` (9 en la v1) con cajas de `boxRows × boxCols` (3 × 3). El motor no asume que el tablero sea de 9 × 9.
- **Índice de celda:** `cell = row × size + col`, de 0 a `size² − 1`.
- **Dígitos:** de 1 a `size`.
- **Candidatos de una celda:** se guardan en una máscara de bits `mask`, donde el bit `d − 1` corresponde al dígito `d`.
- **Unidades de una celda:** su fila, su columna, su caja y su jaula. Las **pares** de una celda son las demás celdas de esas cuatro unidades.

### 2.2 Puzzle

```ts
type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

interface Cage { id: number; cells: number[]; sum: number }      // 2..5 celdas (P2)

// Lo que puede salir del servidor. Vive en packages/protocol.
interface PublicPuzzle {
  id: string;
  size: number; boxRows: number; boxCols: number;
  difficulty: Difficulty;
  cages: Cage[];
  givens: Array<{ cell: number; value: number }>;
}

// Solo servidor (packages/engine y apps/server). NUNCA se importa en packages/protocol.
interface PuzzleRecord extends PublicPuzzle {
  solution: number[];            // size² dígitos
  graderMaxLevel: number;        // técnica máxima requerida (F4/F5), de 1 a 5 en el banco
  graderSteps: number;
  graderVersion: string;         // versión del calificador que dio el nivel (F5)
  generatorVersion: string;
  seed: number;                  // semilla del generador (F5, ADR 0006); nunca sale del servidor
  givensReason: 'none' | 'difficulty' | 'uniqueness'; // 'difficulty' aunque también haya de unicidad
}
```

Cada dificultad tiene sus números iniciales y una banda de niveles que el puzzle cumple calificado con ellos (`docs/dificultad.md`, versión 2). Los puzzles que exceden las técnicas no entran al banco. El `id` es opaco (un UUID aleatorio, T-20.4).

A diferencia de la referencia, las sumas de las jaulas viajan en el puzzle público. Así el cliente no necesita la solución para mostrarlas.

### 2.3 Sala, jugador y partida (estado en memoria del servidor, `RoomStore`)

```ts
type RoomState = 'waiting' | 'running' | 'finished';             // esperando / en curso / terminada
type Role = 'active' | 'spectator';
type Connection = 'connected' | 'disconnected' | 'expired' | 'left';

interface Room {
  code: string;                  // D2
  state: RoomState;
  createdAt: number;
  starterId: PlayerId | null;    // quien puede iniciar (R-10, R-11)
  difficulty: Difficulty;        // elegida en el lobby; por defecto 'easy'
  players: Map<PlayerId, Player>;
  match: Match | null;           // partida en curso o la última terminada
  playedPuzzleIds: string[];     // D9, en orden de juego
  emptySince: number | null;     // desde cuándo no hay nadie conectado (R-14)
}

interface Player {
  id: PlayerId;                  // aleatorio, público
  nickname: string;
  nicknameKey: string;           // NFKC + minúsculas, para la unicidad
  seat: number | null;           // 0..5; null si 'left' o 'expired'
  joinedAt: number;              // antigüedad en la sala (R-11); se conserva al volver
  tokenHash: string;             // SHA-256 de la ficha; la ficha nunca se guarda
  connection: Connection;
  disconnectedAt: number | null;
  settings: { autoCleanPersonalNotes: boolean };   // D5: true
  // Datos de la partida (null fuera de una partida)
  role: Role | null;
  lives: number;
  score: number;
  mistakes: number;
  scoreReachedAt: number | null; // último cambio de puntaje, para el desempate
  personalNotes: Uint16Array;    // una máscara por celda
}

interface Match {
  id: string;
  puzzleId: string;
  difficulty: Difficulty;
  modeId: 'normal';
  scoringParamsVersion: string;  // p. ej. 'v1'
  startedAt: number;
  endedAt: number | null;
  result: 'victory' | 'defeat' | null;
  seq: number;                   // último seq del registro (ADR 0004)
  cells: CellState[];
  groupNotes: Uint16Array;
  hintsLeft: number;             // P1: 3
  excluded: Array<{ cell: number; digit: number }>;  // dígitos de los errores (públicos), para levelToDeduce (F6)
  lastNoteOp: Map<string, number>;          // `group:${cell}:${digit}` | `personal:${playerId}:${cell}:${digit}` → seq de la última modificación (P7)
  recentClientMsgIds: Map<PlayerId, LRU<string, CachedResult>>;  // idempotencia (E-07)
}

type CellState =
  | { status: 'empty' }
  | { status: 'locked'; value: number; source: 'given' | 'solved' | 'hint'; by: PlayerId | null; seq: number };
```

**Asiento ocupado:** lo ocupa un jugador cuya `connection` es `connected` o `disconnected`, tanto en el lobby como en la partida y sea cual sea su rol. Hay como máximo 6 asientos ocupados (R-08).

### 2.4 Ficha de reconexión
- Son 128 bits aleatorios codificados en base64url. Se generan con un CSPRNG al entrar por primera vez.
- Se envían **solo** al dueño, en `room.welcome`. El navegador la guarda en `localStorage` bajo la clave `sk:token:<code>`.
- El servidor guarda solo `tokenHash` (SHA-256), en memoria y en el registro de eventos.
- **Clave de acceso del grupo (F12, R-39):** el navegador la guarda normalizada en `localStorage` bajo `sk:access` y solo la envía en el handshake del WebSocket. Es la misma para todo el grupo y no identifica a nadie.
- La ficha vale para una sala y deja de valer cuando el jugador se purga, es decir, al terminar la partida si había salido o expirado, o al salir o expirar fuera de una partida.

### 2.5 Persistencia
Tablas `puzzles`, `matches` y `match_events`; ver ADR 0003. Los eventos del registro se describen en el ADR 0004 y en la sección 4.6.

Esquema aprobado por el usuario en el punto de control de F9 (migración `0002_matches`):
- `matches`: `id` (el `matchId`, lo genera el servidor), `room_code`, `puzzle_id` (clave foránea a `puzzles`), `difficulty`, `mode_id`, `scoring_params_version`, `protocol_version`, `log_version` (forma de los eventos, hoy 1), `started_at`, `ended_at` y `result`. `ended_at` y `result` son nulos a la vez; se escriben en la misma transacción que `match.ended`. Un índice parcial lista las partidas en curso.
- `match_events`: `(match_id, seq)` como clave primaria, `type` (los 10 tipos), `payload` (jsonb, el del evento tal cual) y `server_ts` (al milisegundo). Solo se agregan filas: un trigger rechaza `UPDATE` y `DELETE`. Al leer, cada evento se valida con su esquema Zod.
- `puzzles` nunca pierde filas: `hash` (el del manifiesto) es único, `mapping_version` guarda la equivalencia y `retired_at` marca los puzzles que salieron del manifiesto. `(generator_version, seed)` es un índice común, porque con otra equivalencia la misma semilla da otro puzzle. Solo se eligen puzzles vigentes; las partidas viejas conservan su clave foránea.

---

## 3. Máquinas de estado

### 3.1 Sala

```
            match.start (starter)            última celda bloqueada → victory
 waiting ─────────────────────────▶ running ───────────────────────────────▶ finished
    ▲                                  │      sin jugadores activos → defeat       │
    │                                  └──────────────────────────────────────────▶│
    └──────────────────────── room.reset (starter) ───────────────────────────────┘

 Cualquier estado ── 2 min sin nadie conectado ──▶ (borrada)
```

| Desde | Disparador | Hasta | Efectos |
|---|---|---|---|
| — | `room.create` | waiting | Quien crea la sala ocupa el asiento 0 y es el `starter`. |
| waiting | `match.start` del starter | running | Se elige el puzzle (D9). Todo jugador con asiento pasa a `active`, con 3 vidas, 0 puntos, 0 errores y notas vacías. Hay 3 pistas. Se registra el evento `match.started`. |
| running | Se bloquea la última celda (por acierto o por pista) | finished | `match.ended{victory}`. |
| running | Ningún jugador queda `active` con `connection ∈ {connected, disconnected}` (D4) | finished | `match.ended{defeat}`. |
| finished | Al entrar | — | Se calcula el ranking. Se **purgan** los jugadores `left` o `expired`: se liberan sus apodos y sus fichas dejan de valer. |
| finished | `room.reset` del starter | waiting | Se borran los datos de partida de los jugadores (`role = null`, notas vacías). `match` queda solo para mostrar el último resultado. |
| cualquiera | `emptySince + 120 s` sin conexiones (R-14) | borrada | Si estaba en `running`, primero expiran los jugadores y se registra `match.ended{defeat}`. Después se borra la sala. |

En `waiting` y en `finished` se puede entrar y salir libremente. En `running` también se puede entrar (R-12).

### 3.2 Jugador: dos ejes independientes
`PLAN.md` describe una cadena lineal (`activo → espectador → desconectado → expirado`). La SPEC la descompone en **dos ejes independientes**, porque un espectador también puede desconectarse.

**Eje de rol** (existe solo durante una partida):

```
 active ── lives llega a 0 ──▶ spectator          (sin vuelta en la misma partida, D11)
```

| Desde | Disparador | Hasta |
|---|---|---|
| — | Inicio de la partida con asiento, o entrada nueva a mitad de partida (R-12) | active (3 vidas) |
| — | Vuelta con ficha (D3, D3') | El rol que tenía: si tenía 0 vidas, spectator |
| active | Error con `lives = 1` | spectator. Conserva sus puntos. |

**Eje de conexión:**

```
 connected ── socket cae / heartbeat falla ──▶ disconnected ── 120 s ──▶ expired
     │  ▲                                          │
     │  └──────────── vuelve con ficha ────────────┘
     └── room.leave ──▶ left
 left / expired ── vuelve con ficha y hay cupo ──▶ connected   (solo en la misma partida)
```

| Desde | Disparador | Hasta | Asiento | Apodo |
|---|---|---|---|---|
| connected | El socket se cierra o pasan 30 s sin pong (ADR 0002) | disconnected | Reservado 120 s | Reservado |
| disconnected | Vuelve con ficha dentro del plazo | connected | El mismo | — |
| disconnected | Pasan 120 s | expired | **Liberado** | En partida: reservado hasta el fin (D2). Fuera de partida: el jugador se purga. |
| connected | `room.leave` | left | **Liberado al instante** | Igual que en `expired` |
| left / expired | Vuelve con ficha a la misma partida y hay cupo | connected | El mismo, si está libre; si no, el primero libre | — |
| left / expired | La partida termina (purga) | (eliminado) | — | Liberado |

Si un jugador vuelve con ficha a una sala que está en `waiting` o `finished` y su entrada sigue existiendo (por ejemplo, está `disconnected`), se aplica la misma tabla.

### 3.3 Derecho de iniciar (starter)
- Lo tiene quien crea la sala.
- Si el starter pasa a `left` o `expired`, el derecho pasa al jugador con menor `joinedAt` entre los que tienen asiento. Si no queda nadie, `starterId = null` y lo recibe el siguiente que entre.
- Mientras el starter está `disconnected`, conserva el derecho.
- El traspaso vale para las partidas siguientes y no se revierte, aunque el antiguo starter vuelva.

---

## 4. Protocolo v1

### 4.1 Transporte y sobre
WebSocket con `ws`, en una sola ruta `/ws` (ADR 0002). Los mensajes son texto JSON validados con Zod en ambos extremos (`packages/protocol`). El cliente ofrece el subprotocolo `sk.v1` y, si tiene la clave de acceso del grupo, `sk.k.<clave normalizada en base64url>` (R-39); el servidor responde siempre con `sk.v1`, nunca con la clave.

```ts
// cliente → servidor
interface ClientEnvelope { v: 1; id: string /* clientMsgId, 1..64 chars, único por jugador */; type: string; payload: unknown }
// servidor → cliente
interface ServerEnvelope { v: 1; type: string; seq?: number; replyTo?: string; payload: unknown }
```

- `seq`: se incluye en los mensajes que reflejan un evento del registro de la partida. Un cliente puede ver saltos de `seq`, porque los eventos privados de otros jugadores no le llegan; **los saltos no indican pérdida**. TCP garantiza el orden y la reconexión trae un snapshot nuevo.
- `replyTo`: el servidor lo agrega en la copia que recibe el autor del comando. Con él, el cliente asocia la respuesta a su solicitud pendiente.

### 4.2 Mensajes del cliente al servidor

| `type` | `payload` | Quién puede | Estado de la sala |
|---|---|---|---|
| `room.create` | `{ nickname }` | Una conexión sin sala | — |
| `room.join` | `{ code, nickname, token? }` | Una conexión sin sala | Cualquiera |
| `room.leave` | `{}` | Miembro | Cualquiera |
| `room.set_difficulty` | `{ difficulty }` | starter | waiting |
| `room.reset` | `{}` | starter | finished |
| `match.start` | `{}` | starter | waiting |
| `cell.place` | `{ cell, digit }` | active | running |
| `hint.use` | `{ cell }` | active | running |
| `note.add` / `note.remove` | `{ layer: 'personal'\|'group', cell, digit }` | active o spectator | running |
| `note.undo` | `{ opSeq }` | Autor de la operación | running |
| `settings.update` | `{ autoCleanPersonalNotes }` | Miembro | Cualquiera |
| `presence.select` | `{ cell: number \| null }` | Miembro con rol | running |
| `sys.ping` | `{ t0 }` | Cualquiera | — |

En `room.join`, si la `token` es válida para esa sala, se reanuda la sesión y se ignora `nickname`. Si la `token` falta o no es válida, la entrada es nueva y se usa `nickname`.

**No existen** mensajes para expulsar jugadores, cerrar la sala, pausar, borrar un número, deshacer una jugada, alternar candidatos ni pedir una segunda oportunidad. El esquema los rechaza con `bad_request` (R-10, R-16, R-25, R-34).

### 4.3 Mensajes del servidor al cliente

| `type` | `payload` | Destino |
|---|---|---|
| `room.welcome` | `{ playerId, token?, snapshot: Snapshot }` | Solo a quien entra. `token` va solo cuando la ficha es nueva. |
| `room.player_joined` | `{ player: PublicPlayer }` | Los demás |
| `room.player_connection` | `{ playerId, connection, seat }` | Todos |
| `room.player_removed` | `{ playerId }` | Todos (purga, o salida y expiración fuera de partida) |
| `room.starter_changed` | `{ playerId \| null }` | Todos |
| `room.difficulty_set` | `{ difficulty }` | Todos |
| `room.state_changed` | `{ state }` | Todos |
| `match.started` | `{ matchId, puzzle: PublicPuzzle, startedAt, hintsLeft, players: PublicPlayer[] }` | Todos |
| `cell.solved` | `{ cell, value, by, points, score, bonuses: Bonus[] }` | Todos |
| `cell.mistake` | `{ cell, digit, by, points, score, livesLeft, role }` | Todos |
| `cell.already_solved` | `{ cell }` | Solo al autor |
| `hint.used` | `{ cell, value, by, points, score, hintsLeft }` | Todos |
| `note.applied` | `{ opSeq, layer, op: 'add'\|'remove', cell, digit, by, undoOf? }` | Grupal: todos. Personal: solo el dueño. |
| `presence.updated` | `{ playerId, cell \| null }` | Los demás (agrupado, ver 4.8) |
| `match.ended` | `{ result, defeatCause?, endedAt, ranking: RankingEntry[] }` | Todos |
| `ack` | `{ applied: boolean }` | Solo al autor, para comandos sin otra respuesta: una nota sin efecto, `settings.update`, `room.leave` |
| `error` | `{ code: ErrorCode, reason? }` | Solo al autor |
| `sys.pong` | `{ t0, serverNow }` | Solo a quien envió el ping |

```ts
interface PublicPlayer { id; nickname; seat; joinedAt; connection; role; lives; score; mistakes }
interface Bonus { unit: 'row' | 'col' | 'box' | 'cage'; index: number; points: number }
interface RankingEntry { playerId; nickname; score; mistakes; scoreReachedAt; position }
```

- `points` es el cambio de puntaje de `by` en ese mensaje, bonus incluidos; `score` es su total nuevo.
- `defeatCause` (1.8) va solo en una derrota y dice cómo terminaron los jugadores del ranking (todos los de la partida, también los que salieron o expiraron): `lives` si todos quedaron con 0 vidas, `gone` si ninguno (salieron o expiraron con vidas) y `mixed` si hay de los dos. Se deriva del estado final de la partida (`defeatCause` de `packages/game`): el evento `match.ended` del registro no cambia de forma y `replay` da la misma causa. Hace falta porque la purga del final (R-22) borra de la sala a quienes salieron o expiraron, y tras recargar el cliente ya no conoce sus vidas.
- **Convención anti-filtración:** el campo `value` solo lleva dígitos **revelados por el servidor**, es decir, de celdas que ese mensaje bloquea o que ya estaban bloqueadas. Los dígitos que aporta un jugador viajan como `digit`. El inspector de la sección 8.3 se basa en esta convención.

### 4.4 Códigos de error

| `code` | Cuándo |
|---|---|
| `bad_request` | El mensaje no cumple el esquema o el tipo no existe. No cambia el estado. |
| `protocol.unsupported` | `v ≠ 1`. Después se cierra la conexión con el código 4000. |
| `rate_limited` | Se superó el límite de mensajes (4.8). |
| `room.not_found` | El código no existe o la sala se borró. |
| `room.full` | No hay asiento libre. |
| `room.wrong_state` | El comando no vale en el estado actual de la sala. |
| `nickname.invalid` / `nickname.taken` | D2 |
| `forbidden` | El rol o el derecho de iniciar no lo permiten. |
| `match.not_running` | Comando de juego sin una partida en curso. |
| `cell.locked` | Nota sobre una celda bloqueada. |
| `hint.none_left` | No quedan pistas. |
| `undo.not_applicable` | `reason`: `modified` (otro jugador, una limpieza o un bloqueo cambiaron ese candidato), `not_owner` o `unknown_op`. |
| `server.unavailable` | La base de datos no responde (ADR 0004), la sala se está reconstruyendo tras un fallo (E-16) o el servidor tuvo un error interno. Nunca lleva detalles. |

Códigos de cierre de la conexión: 1001 (apagado del servidor), 1009 (mensaje de más de 16 KiB), 1012 (la sala se cerró para reconstruirla, E-16), 1013 (saturación, E-17), 4000 (versión, E-19), 4001 (reemplazo, E-08) y 4002 (la conexión no entró a ninguna sala en 30 s, ADR 0002) y 4003 (falta la clave de acceso del grupo o no vale, R-39; se envía al llegar el primer mensaje del cliente, o a los 5 s si no envía nada, T-39.11). Un handshake con un `Origin` ausente o fuera de `ALLOWED_ORIGINS` recibe HTTP 403; una ruta distinta de `/ws`, 404; y uno que ofrece una clave desde una IP que agotó sus intentos, 429 con `Retry-After`. `GET /healthz` responde 204 sin cuerpo (F12). `GET /ws` sin upgrade responde lo que recibiría el handshake: 403 con un `Origin` ajeno, 429 con `Retry-After` si la IP está en espera y 204 si no, con `Access-Control-Allow-Origin: *` (solo un estado, sin datos): el navegador no deja leer el estado de un handshake rechazado (T-39.9).

Un error **nunca** cambia vidas ni puntos.

### 4.5 Snapshot

```ts
interface Snapshot {
  serverNow: number;
  atSeq: number | null;                       // último seq de la partida incluido
  room: { code; state; starterId; difficulty; players: PublicPlayer[] };
  match: null | {
    id; puzzle: PublicPuzzle; startedAt; endedAt; result; defeatCause?; hintsLeft;
    locked: Array<{ cell; value; source; by }>;     // value: solo celdas bloqueadas
    groupNotes: Array<{ cell; mask }>;              // solo celdas con candidatos
    ranking: RankingEntry[] | null;                 // si terminó
  };
  you: { playerId; settings; personalNotes: Array<{ cell; mask }> };
}
```

Se envía al entrar, al volver con ficha y tras una reconstrucción del servidor. El cliente reemplaza su estado por el del snapshot y después reenvía sus comandos pendientes con el mismo `id` (E-07).

### 4.6 Orden, idempotencia y reconciliación
- **Orden:** cada sala procesa sus comandos uno por uno, en el orden de llegada (una cola por sala). "La primera que llega" es la primera que se procesa (R-05).
- **Idempotencia:** el servidor guarda, por jugador, los últimos 256 `clientMsgId` con su resultado. Un duplicado recibe el mismo resultado y no se vuelve a aplicar. Los `clientMsgId` de los comandos que cambian el estado se guardan en el evento, así que la deduplicación sobrevive a un reinicio.
- **Cuándo se confirma:** un evento se difunde **después** de quedar confirmado en la base de datos (group commit, ADR 0004). El estado en memoria se actualiza al procesar el comando, así el comando siguiente ya ve la celda bloqueada.
- **Reconciliación en el cliente:**
  - Las jugadas de números **no son optimistas**: la celda queda "pendiente" hasta el veredicto del servidor.
  - Las notas sí son optimistas: lo que se ve es el estado confirmado más las operaciones pendientes, aplicadas en orden (ADR 0005).

### 4.7 Versionado
- `v` es un entero. Un cambio incompatible sube la versión. Un cambio compatible, como agregar un campo opcional o un tipo nuevo que el cliente puede ignorar, no la sube.
- El servidor de la v1 acepta solo `v = 1`.
- Los esquemas viven en `packages/protocol/src/v1/`. Cada versión nueva será una carpeta aparte.
- El cliente ignora los tipos que no conoce y los registra en el log de depuración.

### 4.8 Límites (valores iniciales, confirmados por la prueba de carga de F11: `docs/carga.md`)

| Límite | Valor |
|---|---|
| Tamaño máximo de un mensaje entrante | 16 KiB (`maxPayload`); si se supera, se cierra la conexión con el código 1009 |
| Velocidad de comandos | Cubeta de 20 por segundo, con ráfagas de hasta 40, por conexión; lo que sobra recibe `rate_limited`. `presence.select` tiene su cubeta (50 por segundo, ráfaga de 50) y `sys.ping` la suya (2 por segundo, ráfaga de 5); lo que sobra de esas dos se descarta sin aviso. |
| Difusión de presencia | Como máximo una cada 100 ms por jugador; solo se envía la última selección |
| Heartbeat | Ping del servidor cada 15 s; la conexión se corta si pasan 30 s sin pong |
| Ping de aplicación del cliente | Cada 5 s; sirve para sincronizar el reloj y detectar caídas desde el cliente |
| Saturación (backpressure) | Con `bufferedAmount` por encima de 256 KiB se descarta la presencia. Por encima de 1 MiB se cierra con el código 1013 y el cliente se reconecta. |
| Conexiones por instancia (F11) | Como máximo 2 000 abiertas a la vez; por encima, el handshake recibe 503. |
| Salas por instancia (F11) | Como máximo 500 a la vez; por encima, `room.create` recibe `server.unavailable`. |
| Conexiones por IP (F12) | Como máximo 40 abiertas a la vez desde una misma IP; por encima, el handshake recibe 503. |
| Plazos del HTTP (F12) | 10 s para recibir las cabeceras y la petición entera (408); no afectan a un WebSocket abierto. |
| Intentos de clave por IP (F12) | 10 claves ofrecidas que no valen en 10 min; después, el handshake desde esa IP que ofrece una clave recibe 429 hasta que pase la ventana. Sin clave ofrecida no cuenta ni espera: recibe 4003. La IP sale de `X-Forwarded-For` contando `TRUST_PROXY_HOPS` desde la derecha, sin puerto y en forma canónica; si la cabecera falta, tiene menos entradas o esa entrada no es una IP, la IP no se sabe y la conexión no tiene espera ni tope por IP (nunca uno compartido por todos). |

---

## 5. Interfaz `GameMode`

El reductor de la partida (`packages/game`, ADR 0004) es puro y delega en el modo todo lo que es propio del modo: permisos, vidas, puntuación, pistas, resultado y ranking. Un modo no puede leer el reloj ni generar números aleatorios; el tiempo le llega en el contexto, desde el evento.

```ts
type Action = 'place' | 'hint' | 'note.personal' | 'note.group' | 'note.undo' | 'presence';

interface ModeRules {
  maxSeats: number;            // Normal: 6
  initialLives: number;        // 3
  teamHints: number;           // 3
  graceMs: number;             // 120_000
  allowMidMatchJoin: boolean;  // true
}

interface PlacementContext {
  state: Readonly<MatchState>;          // estado ANTES de aplicar
  playerId: PlayerId; cell: number; value: number; at: number;
  closedUnits: Array<{ unit: Bonus['unit']; index: number }>;   // unidades que esta jugada completa
  levelToDeduce: number;                // engine.levelToDeduce(cell, { puzzle, values, excluded }) — F4 y F6
}

interface ScoreChange { playerId: PlayerId; delta: number; reason: 'correct' | 'closure' | 'mistake' | 'hint' }

interface GameMode {
  readonly id: string;                                  // 'normal'
  readonly rules: ModeRules;
  can(role: Role, action: Action): boolean;
  onCorrect(ctx: PlacementContext): ScoreChange[];      // incluye bonus de cierre
  onMistake(ctx: { state; playerId; cell; digit; at }): { score: ScoreChange[]; livesDelta: number };
  onHint(ctx: PlacementContext): ScoreChange[];         // Normal: −H para quien la usa, sin cierre
  roleAfterLives(lives: number): Role;                  // Normal: lives > 0 ? 'active' : 'spectator'
  outcome(state: Readonly<MatchState>): 'victory' | 'defeat' | null;
  ranking(state: Readonly<MatchState>): RankingEntry[];
}
```

**Nivel con descartes públicos (F6).** `levelToDeduce` se calcula sobre el estado anterior a la jugada, con los dígitos colocados y con los dígitos de los errores anteriores (`Match.excluded`), que todos vieron en `cell.mistake`. Un error nunca es el dígito de la solución, así que descartarlo no la contradice y el nivel no sube (T-35.8). Así, después de un error entre 2 candidatos, la celda vale lo que vale con un candidato menos, y adivinar «hasta acertar» no cobra el nivel alto (`docs/puntuacion.md`).

**Modo Normal (boceto)**
- `can`: `active` puede hacer todas las acciones. `spectator` puede hacer `note.*` y `presence`.
- La puntuación sale de `createScoring(PARAMS_V1)` (`packages/scoring`), cuyas funciones tienen estas firmas (T-36.5): el modo las usa sin adaptarlas.
- `onCorrect`: `B × w(level)` más β por cada unidad cerrada: un `ScoreChange` `correct` y uno `closure` por unidad, en el orden de `closedUnits`.
- `onMistake`: `{ score: [−P], livesDelta: −1 }`.
- `onHint`: `[−H]`, sin β aunque la pista cierre unidades.
- Parámetros v1 (`params.v1.json`): B = 10, w = 1/2/3/4/5, P = 90, β = 1 y H = 60. `scoreLog(eventos, parámetros)` recalcula una partida con cualquier versión (T-32.4). El evento `cell.solved` guarda `level` y `graderVersion`, calculados al decidir la jugada (F8, ADR 0004): la reproducción no vuelve a calcular `levelToDeduce`, y un cambio de calificador no cambia el nivel de las partidas ya jugadas.
- `outcome`: `victory` si no queda ninguna celda vacía. `defeat` si ningún jugador `active` tiene `connection ∈ {connected, disconnected}`. Si no, `null`.
- `ranking`: ordena por puntaje descendente; a igual puntaje, menos errores; después, menor `scoreReachedAt`. Si todo empata, comparten posición; para mostrarlos se ordenan por apodo.

---

## 6. Reglas como casos verificables

Niveles de prueba:
- **U:** unitaria o de propiedades sobre un paquete puro.
- **I:** integración del servidor con `Transport` falso y reloj falso.
- **C:** componente del cliente.
- **E:** E2E con Playwright.
- **M:** revisión manual.

Entre corchetes va la fase en que se implementa cada prueba.

### Visión del modo Normal (`PLAN.md` §1)

**R-01 Resultado grupal.** El equipo gana al completar el tablero y pierde cuando no queda ningún jugador activo (D4).
- T-01.1 *Dado* una sola celda vacía, *cuando* un jugador activo coloca el valor correcto, *entonces* todos reciben `cell.solved` y después `match.ended{victory}`, y la sala pasa a `finished`. [I, F9]
- T-01.2 *Dado* un único activo con 1 vida y el resto espectadores, *cuando* comete un error, *entonces* pasa a espectador y se emite `match.ended{defeat}`. [I, F9]
- T-01.3 *Dado* un único activo desconectado, *cuando* el reloj falso avanza 120 s, *entonces* expira y se emite `match.ended{defeat}`. [I, F9]
- T-01.4 *Dado* un único activo desconectado durante 60 s y espectadores conectados, *entonces* la partida sigue en `running`. [I, F9]
- T-01.5 *Dado* una sola celda vacía, *cuando* se usa una pista sobre ella, *entonces* el resultado es `victory`. [I, F9]
- T-01.6 La derrota lleva su causa (§4.3): `lives` si todos terminaron con 0 vidas (T-01.2), `mixed` si uno quedó sin vidas y otro expiró (T-01.3) y `gone` si todos expiraron (T-14.3). El snapshot de quien vuelve después de la purga trae la misma causa, y `replay` del registro también. [I, F10]
- T-01.7 Resultados y la franja del tablero muestran el titular y la bajada de la causa: «Se acabaron las vidas.», «La partida quedó sin jugadores.» o «La partida quedó sin jugadores activos.», igual al llegar en vivo y al recargar. Sin causa (un servidor anterior), los de la mezcla. [C, F10]

**R-02 Ranking individual.**
- T-02.1 El ranking ordena por puntaje descendente. [U, F6]
- T-02.2 A igual puntaje, va primero quien tiene menos errores. [U, F6]
- T-02.3 A igual puntaje y errores, va primero quien tiene menor `scoreReachedAt`. [U, F6]
- T-02.4 Los jugadores que salieron o expiraron durante la partida aparecen en el ranking de `match.ended`. [I, F9]

**R-03 Vidas.** Cada jugador tiene 3 vidas. Cada error resta una vida y P puntos. Con 0 vidas, el jugador pasa a espectador y conserva sus puntos.
- T-03.1 *Cuando* un jugador activo coloca un dígito incorrecto, *entonces* pasa de 3 a 2 vidas, su puntaje baja P y todos reciben `cell.mistake` con `by`, `livesLeft` y `role`. [I, F9]
- T-03.2 *Cuando* comete su tercer error, *entonces* `role = spectator` y su puntaje es el anterior menos P. [I, F9]
- T-03.3 Un segundo dígito incorrecto en la **misma** celda cuenta como un error nuevo. [I, F9]

**R-04 Jugadas visibles.** Los aciertos y los errores se notifican a todos con su autor. La celda acertada queda bloqueada. El número erróneo se muestra un instante y luego se retira.
- T-04.1 Después de `cell.solved`, el snapshot de cualquier jugador incluye la celda en `locked`, con `by`. [I, F9]
- T-04.2 Después de `cell.mistake`, el snapshot no guarda ningún valor en esa celda. [I, F9]
- T-04.3 El cliente muestra el dígito erróneo con su autor durante 1500 ms (`--t-error-flash`) y después la celda vuelve a quedar vacía. [C, F8]

**R-05 Celda bloqueada / "ya resuelta" y jugadas simultáneas.** Una celda acertada queda bloqueada. Cualquier jugada posterior sobre ella recibe `cell.already_solved`, sin penalización y sin evento, sea su dígito correcto o incorrecto.
- **Jugadas simultáneas** sobre la misma celda: el servidor las ordena con la cola de la sala (§4.6) y gana la primera que procesa. Si la primera es un acierto, la segunda (y las siguientes) recibe `cell.already_solved`, sin penalización y sin evento, aunque su autor todavía no hubiera visto el `cell.solved`.
- Si la primera es un error, la celda no se bloquea: el error cuenta (R-03) y la siguiente jugada se evalúa con normalidad (E-03).
- T-05.1 *Dado* dos `cell.place` correctos sobre la misma celda en la misma tanda de la cola, *entonces* el primero produce `cell.solved` y el segundo recibe `cell.already_solved`. No cambian vidas ni puntos, y el registro tiene un solo evento. [I, F9]
- T-05.2 Una jugada sobre un número inicial recibe `cell.already_solved`, sin penalización. [I, F9]
- T-05.3 *Dado* una celda bloqueada, *cuando* llega un dígito **incorrecto** sobre ella, *entonces* recibe `cell.already_solved`, no `cell.mistake`. [I, F9]
- T-05.4 Seis pestañas hacen clic en la misma celda a la vez: un solo acierto y ninguna penalización. [E, F10]
- T-05.5 *Dado* un `cell.place` incorrecto seguido de uno correcto sobre la misma celda en la misma tanda de la cola, *entonces* el primero produce `cell.mistake` (−1 vida y −P) y el segundo `cell.solved`. El registro tiene dos eventos. [I, F9]

**R-06 Notas en dos capas.** Cada jugador elige qué capas ve (personal, grupal o ambas) y en cuál escribe.
- T-06.1 El selector de vista oculta y muestra cada capa por separado, y el selector de escritura determina el `layer` que se envía. [C, F8]
- T-06.2 Un `note.add` personal llega solo al dueño; uno grupal llega a todos. [I, F9]
- **Preferencia local del cliente, «Usar notas» (F8):** cada jugador puede desactivar las notas en Ajustes. Se guarda solo en su navegador, no cambia el protocolo ni `settings.update` y no afecta a los demás. Desactivada, el cliente oculta los controles de notas y no dibuja notas; las notas existentes no se borran.
- T-06.3 Con «Usar notas» desactivado no se ve ningún control de notas, y N, G y Supr no envían mensajes; las teclas 1–9 solo colocan números. El ajuste no se envía al servidor. [C, F8]

**R-07 Temporizador común.** Lo controla el servidor, no se pausa y no tiene límite (P9).
- T-07.1 `match.started` y el snapshot incluyen `startedAt` y `serverNow`. No existe ningún comando de pausa: el esquema rechaza `match.pause` con `bad_request`. [U, F8 (esquema); I, F9]
- T-07.2 Con el reloj del cliente desfasado 10 minutos, el cronómetro mostrado coincide con el del servidor (±1 s), gracias al desfase que mide `sys.ping`. [C, F8 / E, F10]
- T-07.3 Después de una reconstrucción por reinicio, el cronómetro es `ahora − startedAt` e incluye el tiempo de caída. [I, F9]

### Reglas de producto (`PLAN.md` §2)

**R-08 Capacidad.** Hay 6 asientos. Los espectadores y los desconectados en gracia conservan el suyo.
- T-08.1 Con 6 asientos ocupados, un séptimo `room.join` recibe `room.full`. [I, F9]
- T-08.2 Un jugador que pasa a espectador sigue ocupando su asiento, así que el séptimo sigue rechazado. [I, F9]
- T-08.3 Un jugador `disconnected` ocupa asiento; uno `left` no lo ocupa. [I, F9]

**R-09 Acceso.** Se entra con código y apodo único, sin cuentas (D2).
- T-09.1 Un código inexistente recibe `room.not_found`. [I, F9]
- T-09.2 "Ana" en una sala donde ya está "ana" recibe `nickname.taken`. [I, F9]
- T-09.3 Un apodo de 1 o de 17 caracteres, o vacío después de recortar espacios, recibe `nickname.invalid`. [U, F9]
- T-09.4 Propiedad: los códigos generados tienen 6 caracteres del alfabeto de D2 y no chocan con una sala existente. [U, F9]

**R-10 Creador.** Solo puede iniciar. No expulsa a nadie ni cierra la sala.
- T-10.1 `match.start` de un jugador que no es starter recibe `forbidden`. [I, F9]
- T-10.2 `room.kick` y `room.close` reciben `bad_request` (no existen). [U, F8]

**R-11 Traspaso del derecho de iniciar.**
- T-11.1 Si el starter sale en el lobby, el derecho pasa al jugador con menor `joinedAt` y todos reciben `room.starter_changed`. [I, F9]
- T-11.2 Si el starter expira durante una partida, el derecho pasa en ese momento y en la partida siguiente inicia el nuevo starter. [I, F9]
- T-11.3 Un starter `disconnected` (dentro de los 120 s) conserva el derecho. [I, F9]
- T-11.4 Un antiguo starter que vuelve con ficha no recupera el derecho. [I, F9]
- T-11.5 Si el starter sale y no queda nadie, el siguiente que entra es el starter. [I, F9]

**R-12 Entrada con la partida en curso.** Quien entra sin ficha y encuentra cupo empieza como activo, con 3 vidas y 0 puntos.
- T-12.1 *Dado* una partida en curso con cupo, *cuando* entra un jugador nuevo, *entonces* es `active`, con 3 vidas y 0 puntos, y recibe un snapshot que pasa el inspector de filtración. [I, F9]
- T-12.2 Sin cupo, recibe `room.full`. [I, F9]

**R-13 Desconexión.** Hay 2 minutos para volver con la ficha y recuperar asiento, vidas, puntos y notas.
- T-13.1 Vuelve a los 119 s: tiene el mismo asiento, vidas, puntos y notas personales, y todos reciben `room.player_connection{connected}`. [I, F9]
- T-13.2 A los 120 s pasa a `expired` y su asiento queda libre. Si vuelve después con ficha y hay cupo, recupera vidas, puntos y notas (D3'). [I, F9]
- T-13.3 Una ficha inválida se trata como una entrada nueva con el `nickname` del mensaje. [I, F9]
- T-13.4 La ficha tiene 128 bits de un CSPRNG. Ni la memoria persistida ni el registro guardan la ficha en claro, solo su hash. [U+I, F9]
- T-13.5 Desconexión y vuelta dentro del plazo, en navegadores reales, sin pérdida de estado. [E, F10]

**R-14 Borrado de la sala.** La sala se borra cuando pasan 2 minutos sin nadie conectado.
- T-14.1 El último conectado se desconecta; 120 s después la sala se borra y un `room.join` posterior recibe `room.not_found`. [I, F9]
- T-14.2 Si alguien vuelve a los 119 s, la sala no se borra. [I, F9]
- T-14.3 Si había una partida en curso, `match.ended{defeat}` queda en el registro antes del borrado. [I, F9]

**R-15 Una celda correcta queda bloqueada para siempre.**
- T-15.1 Propiedad: para cualquier secuencia de comandos, una celda `locked` nunca cambia de valor ni vuelve a `empty`. [U, F8, fast-check sobre el reductor]
- T-15.2 Un `note.add` sobre una celda bloqueada recibe `cell.locked`. [I, F9]

**R-16 Notas grupales con operaciones explícitas, ordenadas por el servidor.**
- T-16.1 El esquema acepta `note.add` y `note.remove`; un hipotético `note.toggle` recibe `bad_request`. [U, F8]
- T-16.2 Propiedad: con secuencias aleatorias de operaciones concurrentes de varios clientes, todos convergen al estado que define el orden del servidor (ADR 0005). [U, F10]
- T-16.3 Un `note.add` de un candidato que ya está recibe `ack{applied:false}` y no genera evento. [I, F9]

**R-17 Limpieza automática.** Al bloquearse una celda con el dígito d, se quita d de sus pares en las notas grupales (fila, columna, caja y jaula). En las notas personales se quita según el ajuste de cada jugador, activado por defecto (D5). Además, siempre se vacían las dos capas de la celda bloqueada.
- T-17.1 Al bloquear (c, d), d desaparece de las notas grupales de los pares de c, y la celda c queda sin notas. [U, F9]
- T-17.2 Con el ajuste activado, las notas personales se limpian igual. Con el ajuste desactivado, solo se vacía la celda c. [U+I, F9]
- T-17.3 Un error no limpia nada. [I, F9]
- T-17.4 Una pista limpia igual que un acierto. [I, F9]
- T-17.5 Un jugador recién entrado tiene `autoCleanPersonalNotes = true`. [I, F9]

**R-18 Diseño visual 100 % propio.**
- T-18.1 Al cerrar F7 hay una revisión explícita que confirma que nada replica la interfaz de la referencia, registrada en `docs/diseno.md`. [M, F7]

### Decisiones de F2

**R-19 Pistas (P1).**
- T-19.1 Un jugador activo usa una pista sobre una celda vacía. Todos reciben `hint.used` con `value` y `by`, la celda queda bloqueada con `source = hint` y `hintsLeft` baja de 3 a 2. Quien la usó pierde H puntos y nadie recibe bonus. [I, F9]
- T-19.2 Con `hintsLeft = 0`, `hint.use` recibe `hint.none_left`. [I, F9]
- T-19.3 Una pista sobre una celda bloqueada recibe `cell.already_solved` y no gasta pista. [I, F9]
- T-19.4 Un espectador que usa `hint.use` recibe `forbidden`. [I, F9]
- T-19.5 Si la pista completa una fila, columna, caja o jaula, nadie recibe β. [U, F6]
- T-19.6 La simulación de F6 incluye el uso de pistas y muestra que pedir una pista no da más puntos que no pedirla, incluido lo que suman las celdas que deja fáciles, y que tampoco compensa usarla para quitarle a otro la celda difícil que está pensando. Se mide en ramas pareadas (con y sin la pista, más un placebo con la misma espera): el efecto neto sobre el propio puntaje y sobre la diferencia con la víctima es ≤ 0 en media. Rama por rama no se exige, porque la partida se desvía y el ruido va en los dos sentidos. [U, F6: versión reducida en la CI y completa en `pnpm test:corpus`]

**R-20 Puzzles (P2).**
- T-20.1 Propiedad sobre los puzzles generados: jaulas de 2 a 5 celdas, conectadas, que cubren todas las celdas, sin dígitos repetidos y con la suma correcta. Ambos solvers confirman que la solución es única. [U, F4]
- T-20.2 Hay números iniciales solo si `givensReason` es `difficulty` o `uniqueness`; en `none` la lista está vacía. Todos son de la solución, y con ellos A y B siguen encontrando una sola solución. Con `difficulty`, el puzzle tiene los de su dificultad (30, 22 o 10; más, solo si los de unicidad ya pasaban esa cantidad), agregados repartidos entre las cajas, en un orden que sale de la semilla. [U, F4/F5]
- T-20.3 Ningún puzzle del banco excede las técnicas: `graderMaxLevel` está entre 1 y 5, y la base de datos rechaza otro valor. Calificado con sus números iniciales, cada puzzle cumple la banda de su dificultad, y las bandas no se solapan: fácil, nivel máximo 1; media, nivel máximo 2; difícil, nivel máximo 3 o 4 con algún paso de nivel 3; experto, nivel máximo 5. Cada semilla pertenece a una sola dificultad, así que dos puzzles del banco nunca comparten cuadrícula y jaulas. Cada dificultad tiene al menos 500 puzzles. [U, F5]
- T-20.4 El banco cargado coincide con el manifiesto versionado (ADR 0006). Cada semilla, regenerada con las versiones vigentes del generador y del calificador, da el mismo puzzle (hash), el mismo nivel, los mismos pasos y la misma dificultad, y si no, la carga falla antes de escribir. Cargar dos veces no duplica filas. El `id` es un UUID aleatorio que no deriva de la semilla, y ni la semilla ni la solución salen en el puzzle público. El `id` es opaco para que un cliente no pueda enumerar el banco ni predecir el puzzle siguiente. Ocultar la semilla no protege la solución: cualquier solver la obtiene del puzzle público, porque es única. Lo que la protege es que el servidor nunca la envía (R-31). [U, F5]
- T-20.5 En partidas simuladas sobre puzzles del banco, en las que las celdas vacías se llenan con la solución en un orden aleatorio, `levelToDeduce` devuelve antes de cada jugada un nivel entre 1 y el `graderMaxLevel` del puzzle, nunca `UNRATED`. F6 puntúa con eso. La CI usa una muestra por dificultad y `pnpm test:corpus`, el banco completo. [U, F5]

**R-21 Dificultad y elección del puzzle (P3, D9).**
- T-21.1 `room.set_difficulty` del starter llega a todos, y `match.start` elige un puzzle de esa dificultad que no esté en `playedPuzzleIds`. [I, F9]
- T-21.2 Si ya se jugaron todos los puzzles de la dificultad en esa sala, se elige el que se jugó hace más tiempo. [U, F9]
- T-21.3 `room.set_difficulty` de un jugador que no es starter recibe `forbidden`. [I, F9]

**R-22 Partidas siguientes (P4).**
- T-22.1 Después de `match.ended`, la sala está en `finished`. Con `room.reset` pasa a `waiting`, y con `match.start` todos los presentes pasan a activos con 3 vidas, 0 puntos y notas vacías, y vuelven a haber 3 pistas. [I, F9]
- T-22.2 El puntaje de la partida anterior no pasa a la nueva. [I, F9]
- T-22.3 Al terminar la partida se purgan los jugadores `left` o `expired`; su apodo queda libre y su ficha deja de valer. [I, F9]

**R-23 Espectadores (P5, D11).**
- T-23.1 La nota grupal de un espectador se aplica y llega a todos. [I, F9]
- T-23.2 Un `cell.place` de un espectador recibe `forbidden`, sin cambio de vidas ni puntos. [I, F9]
- T-23.3 Un espectador que sale y vuelve con ficha sigue siendo espectador. [I, F9]

**R-24 Presencia (P6).**
- T-24.1 Un `presence.select` genera `presence.updated` para los demás y no agrega ningún evento al registro. [I, F9]
- T-24.2 Una ráfaga de 50 selecciones en 1 s produce como máximo 10 difusiones, y la última refleja la selección final. [I, F9]
- T-24.3 El cliente muestra la celda seleccionada de cada compañero. [C, F8]

**R-25 Deshacer notas (P7).**
- T-25.1 Un jugador deshace su `note.add` grupal sin cambios posteriores sobre ese candidato: se aplica un `remove` con `undoOf` y llega a todos. [I, F9]
- T-25.2 Si otro jugador modificó ese candidato (celda y dígito) después, `note.undo` recibe `undo.not_applicable{modified}`, el estado no cambia y el cliente muestra un aviso. [I, F9; C, F8]
- T-25.3 Si después hubo una limpieza automática o se bloqueó la celda, `note.undo` recibe `undo.not_applicable{modified}`. [I, F9]
- T-25.4 Deshacer la operación de otro jugador recibe `undo.not_applicable{not_owner}`. [I, F9]
- T-25.5 Deshacer una nota personal sigue la misma regla, y solo el dueño recibe el resultado. [I, F9]
- T-25.6 No existe un mensaje para deshacer `cell.place`: el esquema lo rechaza. [U, F8]

**R-26 Salir y volver (D3, D3').**
- T-26.1 Un `room.leave` durante una partida libera el asiento al instante (`connection = left`), y el jugador sigue en el ranking. [I, F9]
- T-26.2 Si vuelve con ficha a la misma partida y hay cupo, recupera vidas, puntos y notas personales. [I, F9]
- T-26.3 Si tenía 0 vidas, vuelve como `spectator`. [I, F9]
- T-26.4 Si vuelve con ficha y no hay cupo, recibe `room.full` y sus datos siguen guardados. [I, F9]
- T-26.5 Sin ficha y con otro apodo, entra como jugador nuevo con 3 vidas. Es la limitación aceptada de D3: el test documenta el comportamiento. [I, F9]
- T-26.6 Un `room.leave` en el lobby borra al jugador y libera su apodo. [I, F9]

**R-27 Apodo reservado hasta el fin de la partida (D2).**
- T-27.1 Si un jugador salió o expiró durante la partida, un jugador nuevo que pide su apodo recibe `nickname.taken`. [I, F9]
- T-27.2 Después de `match.ended`, con la purga, ese apodo queda disponible. [I, F9]

**R-28 Error evidente (D6).**
- T-28.1 Un dígito que repite el valor de una celda bloqueada de la misma fila, columna, caja o jaula se procesa como `cell.mistake`. [I, F9]
- T-28.2 El cliente no bloquea la tecla en ese caso. [C, F8]

**R-29 Notas personales privadas (D7).**
- T-29.1 El inspector comprueba que ningún mensaje lleva notas personales de un jugador a otro, ni en `note.applied` ni en snapshots. [I, F9]

**R-30 Se puede iniciar con 1 jugador (D1).**
- T-30.1 En una sala donde solo está el creador, `match.start` funciona. [I, F9]

### Principios de arquitectura

**R-31 La solución nunca sale del servidor.**
- T-31.1 El inspector de la sección 8.3 revisa todos los mensajes salientes de todas las pruebas I y E. [I, F9; E, F10–F11]
- T-31.2 El build de producción del cliente no incluye el servidor simulado ni ninguna solución. Lo comprueba `apps/web/scripts/check-dist.ts` en cada `pnpm build`, con dos revisiones. En los módulos de cada chunk: nada de `src/dev/`, de `packages/bank` ni del manifiesto, y del motor y de `packages/game` solo los módulos de la lista permitida al cliente. En el texto emitido: el identificador `solution`, las claves del manifiesto, la marca del simulador, el SHA-256 en JavaScript del simulador y cualquier solución serializada (81 dígitos seguidos o un arreglo de 81 dígitos). Un fixture de control tiene que hacer fallar el detector, y el build real tiene que pasar. [U, F8]
- T-31.3 `packages/protocol` no exporta ningún tipo con un campo `solution`: lo verifica un test de los tipos exportados. [U, F3/F9]

**R-32 Registro de eventos reproducible.**
- T-32.1 Propiedad: para partidas aleatorias, `replay(registro)` produce el mismo estado y los mismos puntajes que el servidor en vivo. [U, F8 (reductor y modo: `decide` y `apply` paso a paso frente a `replay`, y puntajes frente a `scoreLog`); I, F9 (servidor en vivo)]
- T-32.2 Al reiniciar el servidor, las partidas sin `endedAt` se reconstruyen. Sus jugadores quedan `disconnected` con un plazo nuevo y pueden volver con su ficha. Quien figuraba conectado recibe un evento `player.connection{disconnected}` con la hora del arranque, así el registro sigue reproduciendo el estado. [I, F9]
- T-32.3 Un evento que no se confirmó en la base de datos no se difunde. [I, F9]
- T-32.4 Recalcular los puntajes con otra versión de los parámetros cambia los puntajes sin modificar el registro. [U, F6]

**R-35 Motor del puzzle (F4).** El motor (`packages/engine`) es puro y admite tableros de `size` ≤ 16. Tiene dos solvers independientes: A (propagación y backtracking) y B (Dancing Links), y B no importa código de A. Lo que define que un puzzle es correcto lo confirman los dos.
- T-35.1 *Dado* un puzzle aleatorio o de referencia, A y B devuelven el mismo número de soluciones (0, 1 o 2 o más) y las mismas soluciones. En 4×4 coinciden además con una fuerza bruta. Una discrepancia bloquea F4. [U, F4]
- T-35.2 Los puzzles de referencia tienen un resultado esperado que calcularon A y B y confirmó el validador; nunca se escribe de memoria. [U, F4]
- T-35.3 `validateSolution` acepta solo cuadrículas que cumplen filas, columnas, cajas, sumas de jaula y jaulas sin dígitos repetidos, y respeta los números iniciales. `validateStructure` rechaza jaulas de menos de 2 o más de 5 celdas, no conectadas, solapadas, que no cubren el tablero o con sumas inalcanzables. `checkPlacement` devuelve `correct` solo con el dígito de la solución, e `isEvidentMistake` detecta un dígito repetido en un par bloqueado (R-28). [U, F4]
- T-35.4 El calificador es correcto: en cada paso de `grade`, el dígito de la solución de cada celda sigue entre sus candidatos. [U, F4]
- T-35.5 `levelToDeduce(cell, state)` devuelve un nivel entre 1 y `UNRATED`. Vale 1 si la celda es un single, y no sube al agregar celdas bloqueadas correctas. [U, F4]
- T-35.6 Con la misma semilla y las mismas opciones, el generador produce el mismo puzzle. [U, F4]
- T-35.7 `levelsToDeduce(board)` da en una sola pasada el `levelToDeduce` de cada celda vacía, y sus puntos fijos por nivel son coherentes: una celda tiene un solo candidato en el punto fijo del nivel L si y solo si su nivel es ≤ L, y la solución nunca sale de los candidatos. [U, F6]
- T-35.8 Los descartes públicos (`excluded`, dígitos de errores) no contradicen la solución y no suben ningún nivel. Con 2 candidatos en el punto fijo del nivel L y el falso descartado, la celda queda de nivel ≤ L. [U, F6]

**R-36 Puntuación (F6).** El puntaje es una función pura del registro de hechos y de la versión de los parámetros (`packages/scoring`, `docs/puntuacion.md`).
- T-36.1 Determinismo: `scoreLog` da lo mismo dos veces, con copias del registro y sin modificarlo. [U, F6]
- T-36.2 Cotas: un acierto da entre B·w(1) y B·w(5) + 4β; un error, −P; una pista, −H. [U, F6]
- T-36.3 Monotonía: más aciertos del mismo nivel dan más puntos, y un nivel mayor da al menos los mismos puntos. [U, F6]
- T-36.4 Independencia del orden de los hechos que no se afectan: permutar hechos con su contexto (nivel y unidades cerradas) y su `at` no cambia puntajes, errores ni `scoreReachedAt`. [U, F6]
- T-36.5 `createScoring` encaja en las firmas de `onCorrect`, `onMistake` y `onHint` de la sección 5 sin adaptarlas (prueba de tipos). [U, F6]
- T-36.6 La simulación de F6 es determinista (da lo mismo en el hilo actual, en otro orden y en varios hilos) y, con los parámetros vigentes, adivinar tiene un valor esperado negativo frente a deducir para los adivinadores de nivel 2 y 3, P y H cumplen sus reglas (P > B·(w(5) + w(3)), H = B·w(5) + 10) y β no pasa del 20 % de los puntos de una partida. [U, F6: determinismo en la CI; metas en `pnpm test:corpus` y `scoring:simulate`]

### Reglas del cliente

**R-33 Resaltado de la jaula seleccionada (D10).**
- T-33.1 Al seleccionar una celda, el cliente resalta su jaula, además de la fila, la columna y la caja. [C, F8]

**R-34 Sin segunda oportunidad ni pausa (D8).**
- T-34.1 El esquema no tiene mensajes para pedir una segunda oportunidad ni para pausar, así que esos tipos reciben `bad_request`. [U, F8]

**R-37 Arranque que falla (F8, prueba en la red local).** Si la entrada a la sala o la carga de la partida fallan (un `error` del arranque o del servidor) o no terminan en 15 s, el cliente sale de la sala si llegó a entrar y vuelve al inicio con un aviso de error y «Reintentar», conservando el apodo y la dificultad. Nunca se queda en «Entrando…» para siempre.
- T-37.1 Sin respuesta, a los 15 s aparece el aviso con «Reintentar», que vuelve a enviar `room.create` con el mismo apodo y la misma dificultad. Un `error` a `match.start` durante la carga, o un `error` del servidor sin `replyTo`, lo muestra en el acto. Un apodo en uso sigue siendo un error de campo, y una partida que empieza a tiempo cancela el plazo. [C, F8]
- **Servidor dormido (F12, ADR 0007).** Si la conexión no llegó a abrir desde que empezó la entrada, el plazo es de 2 min en lugar de 15 s: a los 3 s, Entrar muestra «Despertando el servidor…», la conexión se reintenta (como máximo cada 5 s) y `unavailable` no corta la entrada. Al abrir, el aviso se va y vuelve el plazo de 15 s; a los 2 min sin conexión, el aviso con «Reintentar». La página pide `GET /healthz` al abrirse para que el servidor empiece a despertar.
- T-37.2 Sin conexión, el aviso aparece a los 3 s y el de «Reintentar» a los 2 min, aunque el estado pase a `unavailable`; si abre a los 30 s, el aviso se va y vale el plazo de 15 s; con la conexión ya abierta no hay aviso (verificación negativa). [C, F12]
- T-37.3 Con el servidor sin escuchar al entrar, aparece «Despertando el servidor…», sigue a los 11 s sin «Reintentar» y, cuando el servidor arranca, la página entra a la sala sola. [E, F12]

**R-38 Actividad tras una reconexión (F10).** El snapshot no trae el historial de jugadas. Si llega con una partida en curso que ya tiene jugadas (alguna celda bloqueada que no es un número inicial), la línea de actividad y el diálogo «Ver actividad» muestran «La actividad anterior a la reconexión no está disponible.» y las jugadas nuevas se agregan después. Con una partida sin jugadas sigue «Todavía no hay jugadas». La alternativa (las últimas 50 jugadas públicas en el snapshot) está en `docs/IDEAS_FUTURAS.md`.
- T-38.1 Al reconectar o recargar con jugadas previas aparece el aviso en la línea y en el diálogo, y una jugada nueva queda antes que él; sin jugadas, «Todavía no hay jugadas». [C, F10]

**R-39 Clave de acceso del grupo (F12, `docs/seguridad.md` S-02).** Con el juego en internet, el servidor pide una clave compartida por el grupo antes de cualquier sala. Guarda solo su hash (`ACCESS_KEY_HASH`, SHA-256 con prefijo de dominio), obligatorio en producción. La clave se compara normalizada (NFKC, mayúsculas, sin espacios ni guiones) y tiene de 12 a 64 caracteres. Sin clave o con una que no vale, la conexión se cierra con 4003 sin procesar ningún mensaje: en cuanto llega el primero, o a los 5 s. El cliente la pide en «Clave del grupo» una sola vez, la guarda en el dispositivo y repite lo que estaba haciendo; si la guardada no vale, la olvida y la vuelve a pedir. El enlace de invitación (`…/#k=CLAVE`) la guarda y la quita de la URL y del historial; el enlace «Compartir» de la sala nunca la lleva, ni la ficha. La clave nunca va en la URL del WebSocket, en un mensaje ni en un log.
- T-39.1 La clave se normaliza y viaja como subprotocolo `sk.k.` en base64url (también con caracteres fuera de ASCII); una oferta mal formada, corta o larga no trae clave. [U, F12]
- T-39.2 Sin clave o con una que no vale, el handshake se cierra con 4003 y no se crea ninguna sala; con la clave (escrita en minúsculas y sin guiones), el servidor elige `sk.v1` y se juega. Sin clave configurada, las mismas ofertas se aceptan (verificación negativa). Ni la clave, ni su hash, ni la oferta llegan al log. [I, F12]
- T-39.3 Tras 10 claves que no valen desde una IP, esa IP recibe 429 (una respuesta HTTP completa, con `Retry-After`) hasta que pasa la ventana; otra IP no se ve afectada, y escribir otra dirección a la izquierda de `X-Forwarded-For` no cambia la del cliente. [I, F12]
- T-39.4 El cierre 4003 lleva a «Clave del grupo» sin reintentar solo; una clave corta se rechaza; la válida se guarda normalizada y la entrada se repite con los mismos datos; una guardada que no valió se olvida. [C, F12]
- T-39.5 El enlace `#k=` guarda la clave y deja la URL en `#/`, también con una clave inválida (que no se guarda). [C, F12]
- T-39.6 Contra el servidor real: la invitación guarda la clave; la URL del WebSocket termina en `/ws`, la página y el enlace de «Compartir» no tienen la clave; otra persona sin clave ve «Clave del grupo», con una que no vale ve que ya no vale y con la vigente entra a la sala. [E, F12]
- T-39.7 Un navegador sin clave nunca recibe 429: doce navegadores sin clave detrás de la misma entrada del proxy reciben 4003, y después uno con la clave entra (el fallo del primer despliegue). [I, F12]
- T-39.8 Con la cabecera ausente, con menos entradas que `TRUST_PROXY_HOPS` o con una entrada que no es una IP, las claves que no valen no bloquean a nadie; la misma IP con puerto, entre corchetes o mapeada en IPv6 es la misma IP. [I, F12]
- T-39.9 `GET /ws` responde 403 con un origen ajeno, 429 con `Retry-After` si la IP está en espera (también sin `Origin`) y 204 si no, legible desde otro origen. [I, F12]
- T-39.10 Tras un intento que no llegó a abrir, el cliente pregunta `GET /ws`: con 429 pide esperar en «Clave del grupo», conserva la clave y ofrece «Reintentar»; con 403 la entrada falla con «Reintentar»; con 4003 y sin clave, «Clave del grupo»; en ningún caso queda «Despertando el servidor…». Otra respuesta, o ninguna, sigue con la espera exponencial. [U y C, F12]
- T-39.11 Detrás de un proxy que pierde lo que el servidor envía tras el 101 antes de que hable el cliente (lo que pasaba en Render, F12j), un cliente sin clave o con una que no vale recibe igual el 4003 al enviar su primer mensaje, y con la clave juega; uno que no envía nada se cierra con 4003 a los 5 s. Sin clave cuenta como conexión sin clave (`accessMissing`), no como clave rechazada (`accessDenied`). La prueba de humo lo comprueba en producción (`smoke.ws_keyless_4003`). Verificación negativa: con el cierre junto con el 101, el cliente detrás del proxy nunca recibe el 4003. [I, F12]

---

## 7. Casos límite

| ID | Situación | Comportamiento esperado | Pruebas |
|---|---|---|---|
| E-01 | Un jugador se desconecta durante la partida y vuelve antes de 2 min | Recupera todo. Mientras estuvo fuera conservó su asiento y contó como activo para D4. | T-13.1, T-01.4 |
| E-02 | Un jugador expira y vuelve más tarde | Con cupo, recupera sus datos; sin cupo, recibe `room.full`. Nunca vuelve con 3 vidas nuevas. | T-13.2, T-26.4 |
| E-03 | Llegan a la vez un acierto y un error sobre la misma celda | Gana el primero en la cola. Si el primero es el acierto, el error recibe `already_solved` y no penaliza. Si el primero es el error, cuenta como error y el acierto bloquea la celda. | T-05.1, T-05.3, T-05.5 |
| E-04 | Llegan a la vez una pista y una jugada sobre la misma celda | Gana el primero. Si la pista llega segunda, recibe `already_solved` y no gasta pista. | T-19.3 |
| E-05 | El creador sale antes de iniciar, durante la partida, o se desconecta | Antes de iniciar o durante la partida, el derecho pasa en el momento de salir o expirar. Si solo está desconectado, lo conserva. | T-11.1–T-11.5 |
| E-06 | Todos se desconectan | 120 s después de la última desconexión, todos expiran. Si había partida en curso, se registra la derrota y después se borra la sala. Si alguien vuelve antes, se cancela el borrado. | T-14.1–T-14.3 |
| E-07 | Reconexión en medio de un evento: el comando se envió y la conexión cayó antes de la respuesta | El cliente vuelve con su ficha, recibe el snapshot y reenvía los pendientes con el mismo `id`. Un comando ya aplicado devuelve el resultado guardado y no penaliza dos veces. Si el evento se confirmó mientras el cliente estaba fuera, ya aparece en el snapshot. | T-32.1, prueba I específica en F9 (`idempotency.reconnect`) |
| E-08 | La misma ficha se abre en dos pestañas | La conexión nueva reemplaza a la anterior, que se cierra con el código 4001 (`replaced`). | Prueba I en F9 |
| E-09 | Entrada a mitad de partida con la sala llena | `room.full`. Con cupo, el jugador entra activo con 3 vidas. | T-12.1, T-12.2 |
| E-10 | El último jugador activo pierde su última vida mientras quedan espectadores | Derrota inmediata. | T-01.2 |
| E-11 | El último jugador activo sale | Derrota inmediata (D4). Aunque después vuelva, la partida ya terminó. | T-01.3, T-26.1 |
| E-12 | Llegan comandos después de la victoria | `match.not_running`, sin efecto. | T-01.1 |
| E-13 | Se deshace una nota grupal que otro jugador modificó | `undo.not_applicable{modified}` y un aviso. | T-25.2 |
| E-14 | Un jugador nuevo pide el apodo de alguien que salió | `nickname.taken` hasta que termine la partida. | T-27.1, T-27.2 |
| E-15 | El servidor se reinicia durante una partida | La partida se reconstruye desde el registro, con plazos de gracia nuevos. El cronómetro sigue desde `startedAt`. Las salas en lobby se pierden. | T-32.2, T-07.3 |
| E-16 | La base de datos falla al confirmar eventos | No se difunde nada que no esté confirmado, ni siquiera las respuestas sin evento que vienen después. Los comandos que cambian el estado reciben `server.unavailable`; la presencia y el ping siguen. El lote se reintenta cada segundo. Si el fallo dura 10 s, la sala se cierra (las conexiones con 1012), se reconstruye desde el registro confirmado cuando la base responde, y mientras tanto `room.join` a ese código recibe `server.unavailable`. Ningún cliente vio los eventos perdidos; el cliente reenvía sus pendientes con el mismo `id`. | T-32.3, prueba I en F9 |
| E-17 | Un cliente consume demasiado lento | Primero se descarta la presencia y después se cierra con 1013. El cliente se reconecta y recibe un snapshot. | Prueba I en F9, carga en F11 |
| E-18 | Llega un mensaje inválido, demasiado grande o de un tipo desconocido | `bad_request` sin cambio de estado; si es demasiado grande, se cierra con 1009. | T-10.2, T-16.1 |
| E-19 | El cliente usa otra versión del protocolo | `protocol.unsupported` y cierre con 4000. | Prueba U en F9 |
| E-20 | Vuelve con ficha un jugador que tenía 0 vidas | Vuelve como espectador. | T-26.3, T-23.3 |
| E-21 | Un espectador intenta jugar o pedir una pista | `forbidden`, sin efecto. | T-23.2, T-19.4 |
| E-22 | La última celda se resuelve con una pista | Victoria; nadie recibe bonus de cierre. | T-01.5, T-19.5 |
| E-23 | El asiento de un jugador expirado lo ocupa otro, y el expirado vuelve | Necesita cupo; si no lo hay, recibe `room.full`. | T-26.4 |
| E-24 | El reloj del cliente está mal | El cronómetro usa el desfase medido con `sys.ping`. | T-07.2 |

---

## 8. Plan de pruebas

### 8.1 Niveles y herramientas

| Nivel | Herramienta | Qué cubre | Fase |
|---|---|---|---|
| Unitarias y de propiedades | Vitest y fast-check | Motor (solvers, generador, calificador), puntuación, reductor de la partida, esquemas del protocolo | F4, F6, F9 |
| Integración del servidor | Vitest, `Transport` en memoria, `Clock` falso, PGlite | Todos los T de nivel I: máquinas de estado, plazos, cola por sala, persistencia | F9 |
| Componentes | Vitest y Testing Library | Los T de nivel C | F8 |
| E2E | Playwright (6 contextos de navegador) | Partida completa, clics simultáneos, reconexión | F10–F11 |
| Caos | Playwright con cortes de red | E-01, E-07, E-17 | F11 |
| Carga | Script con muchos clientes WS | 50 salas, p95 menor a 150 ms y memoria | F11 |
| Manual | Lista de revisión | T-18.1 | F7 |

### 8.2 Interfaces que hacen testeable al servidor
- `Transport`: se implementa con `ws` en producción y en memoria para las pruebas.
- `Clock`: con `now()` y temporizadores. En las pruebas es un reloj falso que se avanza a mano, y con él se prueban los 120 s.
- `IdGenerator` / `Random`: tienen semilla en las pruebas.
- `RoomStore`, `PuzzleRepository` y `MatchRepository`: los repositorios usan PGlite en las pruebas.

### 8.3 Inspector de filtración (T-31.1, T-29.1)
Es un envoltorio del `Transport` de pruebas que revisa **cada** mensaje saliente y hace fallar la prueba si encuentra alguna de estas cosas:
1. Una clave llamada `solution`, `tokenHash` o `token`. La única excepción es `token` en el `room.welcome` dirigido a su propio dueño.
2. La solución de la partida serializada en cualquier forma: el texto de 81 dígitos o el arreglo JSON.
3. Un campo `value` en una celda que no queda bloqueada a más tardar en ese mismo mensaje (convención de 4.3).
4. Notas personales de un jugador en un mensaje destinado a otro.

El inspector está activo por defecto en todas las pruebas I. Las pruebas E2E usan una versión equivalente sobre el tráfico WS que captura Playwright.

### 8.4 Pruebas transversales
- **Reproducción (T-32.1):** se generan partidas aleatorias con fast-check y se comprueba que `replay(eventos) ≡ estado en vivo`, incluidos puntajes, ranking, notas y vidas.
- **Convergencia de notas grupales (T-16.2):** varios clientes simulados, con operaciones optimistas, latencias aleatorias y reordenamiento de las entregas, terminan con el mismo estado.
- **Esquemas:** cada mensaje de los catálogos 4.2 y 4.3 tiene un ejemplo válido y uno inválido en `packages/protocol`.

### 8.5 Matriz de cobertura de `PLAN.md` §2

| Regla del plan | R | Pruebas |
|---|---|---|
| Capacidad | R-08 | T-08.1–3 |
| Acceso | R-09 | T-09.1–4 |
| Creador | R-10 | T-10.1–2 |
| Si el creador se va antes de iniciar | R-11 | T-11.1–5 |
| Entrada con partida en curso | R-12 | T-12.1–2 |
| Desconexión | R-13 | T-13.1–5 |
| Borrado de sala | R-14 | T-14.1–3 |
| Celdas | R-15 (+R-05) | T-15.1–2, T-05.1–5 |
| Notas grupales | R-16 | T-16.1–3 |
| Limpieza automática | R-17 | T-17.1–5 |
| Diseño visual | R-18 | T-18.1 |

Todas las reglas de la visión (R-01 a R-07), las decisiones de F2 (R-19 a R-34), el motor (R-35), la puntuación (R-36) y el arranque del cliente (R-37) y la actividad tras una reconexión (R-38) tienen también sus pruebas en la sección 6.
