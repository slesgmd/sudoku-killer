# 0005 — Notas grupales

- Estado: aceptada
- Fecha: 2026-10-22

## Contexto
Las notas grupales son una capa de candidatos compartida, en la que escriben a la vez hasta 6 personas, espectadores incluidos (P5). El plan exige operaciones explícitas de agregar o quitar, ordenadas por el servidor, sin alternar (`PLAN.md` §2), y una limpieza automática al bloquearse una celda. P7 agrega el deshacer con una condición: solo se aplica si el estado sigue siendo el que dejó la operación. La interfaz tiene que responder al instante aunque haya latencia.

## Decisión

**Modelo**
- Una máscara de bits por celda, `groupNotes[cell]`. El servidor la mantiene a partir de `note.op` (ADR 0004).
- Las operaciones son `add(cell, digit)` y `remove(cell, digit)`. Son idempotentes respecto del resultado: un `add` de un candidato que ya está no cambia nada, responde `ack{applied:false}` y **no** se registra.
- El orden lo da el `seq` del servidor. Dos operaciones concurrentes sobre el mismo candidato se resuelven por ese orden, y como todos los clientes reciben los eventos en el mismo orden, convergen.
- No hay "alternar". Dos "alternar" concurrentes se anularían entre sí sin que nadie lo viera, y por eso la regla del plan lo prohíbe.

**Cliente optimista**
- El cliente guarda dos cosas: el estado confirmado y una lista de operaciones pendientes con su `clientMsgId`.
- Lo que se ve es el estado confirmado más las pendientes, aplicadas en orden.
- Al llegar un `note.applied` con `replyTo` propio, se quita esa operación de la lista.
- Al llegar un error o un `ack{applied:false}`, también se quita. Al reconstruir la vista, se corrige sola.
- Al llegar operaciones de otros, se actualiza el estado confirmado y las pendientes se vuelven a aplicar encima.
- Al reconectarse, el snapshot reemplaza el estado confirmado y las pendientes se reenvían con el mismo `id` (servidor idempotente).

**Limpieza automática (R-17)**
- No hay un mensaje aparte: la limpieza es una consecuencia determinista de `cell.solved` y `hint.used`.
- La aplican igual el servidor, cada cliente y la reproducción, con la misma función de `packages/engine`, `cleanupPeers(cell, digit)`:
  - quita `digit` de la fila, la columna, la caja y la jaula de la celda;
  - vacía la celda bloqueada.
- En las notas personales se aplica según `autoCleanPersonalNotes`; la celda bloqueada se vacía siempre.
- Las notas sobre celdas bloqueadas se rechazan con `cell.locked`.

**Deshacer (P7)**
- El cliente guarda una pila local con sus propias operaciones aplicadas (con su `opSeq`), de hasta 50, en las dos capas.
- Para deshacer, envía `note.undo{opSeq}`. El servidor:
  1. comprueba que la operación es del jugador; si no, responde `not_owner`;
  2. busca `lastNoteOp[clave(capa, celda, dígito)]`, que se actualiza con cada `note.op` y con cada limpieza o bloqueo que toca ese candidato;
  3. si es igual a `opSeq`, el estado sigue siendo el que dejó esa operación: aplica la inversa como un `note.op` nuevo con `undoOf = opSeq`;
  4. si no, responde `undo.not_applicable{modified}` y el cliente avisa que otro jugador cambió esa nota.
- La pila de deshacer no sobrevive a una recarga de la página. Es aceptable, porque no forma parte del estado de la partida.

## Alternativas consideradas
- **CRDT (OR-Set por celda):** sirve para trabajar sin conexión y sin un servidor central. Aquí siempre hay servidor autoritativo y conexión, así que agrega metadatos y complejidad sin ningún beneficio.
- **El conjunto completo de la celda, gana la última escritura:** dos jugadores que agregan dígitos distintos a la vez se pisarían.
- **Alternar:** lo prohíbe el plan, por la anulación silenciosa entre operaciones concurrentes.
- **Deshacer sin comprobación (inversa ciega):** podría deshacer el trabajo de otro jugador. El autor pidió la comprobación (P7).
- **Limpieza como eventos explícitos de borrado:** infla el registro y abre la puerta a divergencias si un cliente se pierde un evento. La función determinista hace lo mismo con menos datos.

## Consecuencias
- La convergencia se puede verificar con una prueba de propiedades (T-16.2).
- La misma lógica de pendientes sirve para las notas personales. Allí también hay comprobación al deshacer, porque la limpieza automática puede modificar la nota.
- La función `cleanupPeers` forma parte del contrato del motor (F4). Si cambia, también cambia la reproducción de partidas viejas, así que su comportamiento se fija con tests.
