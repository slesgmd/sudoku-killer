# 0004 — Registro de eventos por partida

- Estado: aceptada
- Fecha: 2026-10-22

## Contexto
`PLAN.md` §3.3 pide que el estado, la puntuación y la reconexión se reconstruyan reproduciendo los eventos de cada partida, y que `puntaje = f(registro, versión de parámetros)`. También hay que reconstruir las partidas tras un reinicio (ADR 0003) y deduplicar los comandos reenviados (SPEC §4.6).

## Decisión

**Forma**
- Cada partida tiene su registro, al que solo se agregan eventos. Cada evento es `{ matchId, seq, ts, type, payload }`.
- `seq` empieza en 1, sube de a 1 y lo asigna el servidor.
- `ts` es la hora del servidor en milisegundos.
- Los eventos guardan **hechos**, no resultados derivados: por ejemplo, "el jugador X colocó el valor v en la celda c", no "X ganó 15 puntos". Los puntos, las limpiezas automáticas, los cambios de rol y el resultado se recalculan al reproducir.

**Tipos de evento de la v1**

| `type` | `payload` |
|---|---|
| `match.started` | `matchId`, `puzzleId`, `difficulty`, `modeId`, `scoringParamsVersion`, `hintsTotal`, `starterId` y `players[]`, con `{ playerId, nickname, seat, joinedAt, tokenHash, connection, autoCleanPersonalNotes }` |
| `player.joined` | Entrada nueva a mitad de partida, con los mismos campos que un elemento de `players[]` |
| `player.connection` | `{ playerId, connection, seat }`: desconexión, vuelta, expiración o salida |
| `starter.changed` | `{ playerId \| null }` |
| `settings.changed` | `{ playerId, autoCleanPersonalNotes, clientMsgId }` |
| `cell.solved` | `{ playerId, cell, value, level, graderVersion, clientMsgId }` |
| `cell.mistake` | `{ playerId, cell, digit, clientMsgId }` |
| `hint.used` | `{ playerId, cell, value, clientMsgId }` |
| `note.op` | `{ layer, ownerId, playerId, cell, digit, op, clientMsgId, undoOf? }` |
| `match.ended` | `{ result }` |

Lo que no se registra:
- La presencia, los pings y los errores de validación.
- Los comandos rechazados.
- Los `cell.already_solved`, porque no cambian el estado.

Las expiraciones **sí** se registran, con su `ts`. Así la reproducción no depende de temporizadores.

**Reductor puro en `packages/game`**
- La función es `apply(state, event, mode, params, engine) → state`. `replay(events)` es un `reduce` que empieza en el estado inicial.
- El paquete depende de `engine`, `scoring` y de los tipos de `protocol`, sin E/S, reloj ni azar: el tiempo viene en `event.ts`.
- El mismo reductor lo usan:
  - el servidor en vivo;
  - la reconstrucción tras un reinicio;
  - el recálculo de puntajes;
  - el servidor simulado del cliente en F8.
- El modo de juego se inyecta como `GameMode` (SPEC §5).

**Confirmar antes de difundir (group commit)**
1. El comando se valida y se aplica al estado en memoria. Así el siguiente comando de la cola ve el cambio y se mantiene la regla de que gana la primera jugada.
2. El evento entra en una cola de escritura.
3. Cada 10 ms, o cada 64 eventos, se escribe un lote en una sola transacción (`INSERT` de varias filas).
4. Recién después de la confirmación se difunden los mensajes de esos eventos.

El costo previsto es de 10 a 20 ms de latencia, que entra en el objetivo de p95 menor a 150 ms. Si la escritura falla, la sala responde `server.unavailable`. Si el fallo dura más de 10 s, la sala se cierra y se reconstruye desde lo confirmado (SPEC E-16).

**Idempotencia:** el `clientMsgId` va en los eventos de comandos. Al reconstruir, se repuebla la caché de duplicados de cada jugador.

**Versionado:** `matches.scoring_params_version` y `protocol_version` fijan con qué reglas se jugó. Para recalcular con otros parámetros, se ejecuta `replay` con `params` distintos, sin tocar el registro (T-32.4).

**Sin snapshots en la v1:** una partida tiene del orden de 10³ eventos, y reproducirla tarda milisegundos. Se agregan si F11 muestra que hacen falta.

## Alternativas consideradas
- **Guardar el estado y no los eventos:** pierde la depuración y la posibilidad de recalibrar.
- **Guardar también los resultados derivados (puntos):** es cómodo para consultar, pero se desincroniza al cambiar los parámetros. Si hace falta, se puede agregar una vista materializada que se recalcule.
- **Escritura asíncrona sin esperar la confirmación:** tiene menos latencia, pero un reinicio podría perder eventos que los clientes ya vieron, y los estados quedarían desincronizados para siempre.
- **Un evento por transacción:** es más simple, pero cuesta más bajo carga. Agrupar en lotes da el mismo resultado.
- **Event store dedicado (EventStoreDB, Kafka):** es excesivo para una sola instancia.

## Consecuencias
- Hay un paquete nuevo, `packages/game` (plan 1.04, F3).
- La reproducción determinista se vuelve un invariante probado (T-32.1). Cualquier uso de `Date.now()` o `Math.random()` dentro del reductor es un error; se agrega una regla de lint en F3.
- Cambiar la forma de un evento exige migrar o versionar el registro. Por eso los eventos llevan solo hechos mínimos.

## Nota de F8 (2026-10-24): forma definitiva de los eventos
- El reductor y el modo Normal quedaron en `packages/game` (`decide`, `apply`, `replay` y `project`). El servidor simulado de F8 los usa tal cual, y F9 los reutiliza sin reescribirlos.
- `cell.solved` guarda `level` (el `levelToDeduce` antes de la jugada, con los descartes públicos) y `graderVersion`, calculados al decidir. La reproducción no vuelve a calcular el nivel, y una versión nueva del calificador no cambia la puntuación de las partidas ya jugadas. Era la recomendación de F6 (`docs/puntuacion.md`).
- Cada entrada de jugador (`players[]` de `match.started` y `player.joined`) lleva su `connection`. Quien entra a mitad de partida puede llegar en cualquier estado de conexión, y la reproducción no tiene que adivinarlo.
- `match.started` lleva `matchId` y `settings.changed` lleva `clientMsgId`, para la idempotencia.
- La tabla de arriba ya refleja estos cambios. Las pruebas de propiedad T-15.1 y la base de T-32.1 (estado en vivo igual a `replay`, y puntajes iguales a `scoreLog`) corren desde F8.
