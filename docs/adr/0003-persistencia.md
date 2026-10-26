# 0003 — Persistencia

- Estado: aceptada
- Fecha: 2026-10-22

## Contexto
Hay que guardar tres cosas:
- El banco de puzzles (F5), con soluciones que nunca deben salir del servidor.
- Las partidas y su registro de eventos (ADR 0004), para depurar y para recalibrar la puntuación.
- El estado vivo de las salas, de acceso muy frecuente.

La v1 corre en una sola instancia (`PLAN.md` §3), con las interfaces `RoomStore`, `PuzzleRepository` y `MatchRepository`.

## Decisión

**Dónde vive cada cosa**

| Dato | Dónde | Interfaz |
|---|---|---|
| Estado vivo de las salas (SPEC §2.3) | Memoria del proceso | `RoomStore` (con Redis más adelante) |
| Puzzles con su solución | PostgreSQL, tabla `puzzles` | `PuzzleRepository` |
| Partidas | PostgreSQL, tabla `matches` | `MatchRepository` |
| Registro de eventos | PostgreSQL, tabla `match_events` | `MatchRepository` |

**Esquema inicial** (Drizzle, con migraciones versionadas)
- `puzzles`: `id`, `size`, `box_rows`, `box_cols`, `difficulty`, `cages` (jsonb), `givens` (jsonb), `solution` (text), `grader_max_level`, `grader_steps`, `givens_reason`, `generator_version` y `created_at`. Hay un índice por `difficulty`.
  - **Nota de F5 (2026-10-23):** se agregan `grader_version` y `seed` (bigint, porque la semilla es un entero de 32 bits sin signo), con un índice único `(generator_version, seed)`.
  - El `id` es un UUID aleatorio (`gen_random_uuid()`), opaco, para que un cliente no pueda enumerar el banco ni predecir el puzzle siguiente.
  - `solution` guarda un carácter en base 36 por celda.
  - La base de datos comprueba que `grader_max_level` esté entre 1 y 5 y que `difficulty` y `givens_reason` tengan valores válidos.
  - Cómo se carga el banco: ADR 0006.
- `matches`: `id`, `room_code`, `puzzle_id`, `mode_id`, `scoring_params_version`, `protocol_version`, `started_at`, `ended_at` (null si sigue en curso) y `result`.
- `match_events`: `match_id`, `seq`, `type`, `payload` (jsonb) y `server_ts`, con la clave primaria `(match_id, seq)`. Solo se agregan filas; no hay `UPDATE` ni `DELETE` desde la aplicación.

**La solución solo vive en el servidor**
- `solution` solo se lee a través de `PuzzleRepository.getForServer()`, que devuelve `PuzzleRecord`.
- `getPublic()` construye el `PublicPuzzle` sin esa columna.
- Ningún tipo de `packages/protocol` la referencia (T-31.3).

**Fichas:** solo se guarda `tokenHash`, dentro de los eventos de unión (ADR 0004). La ficha en claro no se guarda en ningún lugar.

**Qué pasa si el servidor se reinicia**
1. **Lo que se pierde:** el estado en memoria, es decir, las salas en lobby y en resultados (`waiting` y `finished`), la presencia y los temporizadores. Las salas sin partida en curso no se recuperan. Sus jugadores ven que la sala no existe (`room.not_found`) y pueden crear otra.
2. **Las partidas en curso se reconstruyen desde el registro.**
   - Al arrancar, y antes de aceptar conexiones, el servidor busca las partidas con `ended_at IS NULL` y reproduce sus eventos con el reductor puro (ADR 0004).
   - Así recupera el tablero, las vidas, los puntos, las notas personales y grupales, las pistas, el starter y los hash de las fichas.
3. **Estado tras la reconstrucción:**
   - La sala queda en `running` con el mismo código.
   - Todos los jugadores con asiento quedan `disconnected`, con un plazo de gracia **nuevo** de 120 s desde el arranque, y vuelven con su ficha. Los que estaban `left` o `expired` siguen igual.
   - El cronómetro no se pausa: el tiempo transcurrido es `ahora − startedAt` e incluye la caída (R-07).
4. **Si nadie vuelve en esos 120 s**, se aplican las reglas normales: expiran todos, se registra la derrota (D4) y se borra la sala.
5. **Por qué se puede reconstruir:** el ADR 0004 confirma cada evento en la base de datos **antes** de difundirlo. Lo único que se puede perder es un comando que se procesó en memoria pero no se confirmó. Ese comando nunca llegó a ningún cliente, y el cliente lo reenvía con el mismo `clientMsgId` al reconectarse (SPEC §4.6).

**Respaldos:** se definen en F12 (base de datos gestionada con respaldos y una prueba de restauración).

## Alternativas consideradas
- **Guardar periódicamente el estado completo de cada sala:** duplica la fuente de verdad, y el registro ya basta.
- **Redis para el `RoomStore` desde la v1:** agrega infraestructura sin necesidad, porque hay una sola instancia. La interfaz deja la puerta abierta.
- **Guardar la solución cifrada:** no aporta, porque el servidor necesita la clave igual. Basta con el aislamiento por tipos y por repositorio, más el test de filtración.
- **Perder las partidas al reiniciar:** es más simple, pero desaprovecha el registro y frustra al grupo en cada despliegue.

## Consecuencias
- Los despliegues de F12 interrumpen la partida unos segundos, pero no la pierden.
- El arranque tarda más cuantas más partidas haya en curso. Es despreciable con la carga prevista; hay que medirlo en F11.
- La tabla `match_events` crece sin límite. En la v1 se conserva todo; la retención se revisa en F13.

## Nota de F9 (2026-10-24): esquema y reconstrucción
- **Esquema aprobado por el autor en el punto de control de F9** (migración `0002_matches`, SPEC §2.5): `matches` suma `log_version` y un índice parcial de las partidas en curso; `match_events` tiene un trigger que rechaza `UPDATE` y `DELETE`.
- **El banco nunca pierde filas.** `puzzles` suma `hash` (único), `mapping_version` y `retired_at`. El índice `(generator_version, seed)` deja de ser único: con otra equivalencia, la misma semilla da otro puzzle, y `ON CONFLICT DO NOTHING` se habría quedado con la fila vieja. Detalle en el ADR 0006.
- **Reconstrucción:** al arrancar, antes de aceptar conexiones, el servidor reproduce las partidas sin `ended_at` y registra un `player.connection{disconnected}` por cada jugador que figuraba conectado. Todos los que tienen asiento reciben un plazo nuevo de 120 s. La caché de idempotencia se repuebla con los `clientMsgId` de los eventos.
- **Base de datos:** `pg` en producción y en desarrollo (PostgreSQL 18 local, con un rol propio sin privilegios y la base `sudoku_killer`, creados con `db:setup-local`); PGlite en memoria en las pruebas, con las mismas migraciones. `DATABASE_URL` solo llega por el entorno (`apps/server/.env` en desarrollo) y nunca se registra.
- **Migraciones al arrancar:** el servidor aplica las pendientes al iniciar (una sola instancia). En F12 hay que revisarlo: en producción, una migración destructiva no debe aplicarse sola.
