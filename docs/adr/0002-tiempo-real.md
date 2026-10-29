# 0002 — Comunicación en tiempo real

- Estado: aceptada
- Fecha: 2026-10-22

## Contexto
Hasta 6 jugadores por sala intercambian jugadas, notas y presencia con latencia baja (objetivo: p95 menor a 150 ms en la prueba de carga).

El servidor es autoritativo. El estado se reconstruye desde un registro de eventos propio (ADR 0004), y el protocolo tiene versión y se valida con Zod (SPEC §4). La reconexión se hace con una ficha propia, con un plazo de gracia de 2 minutos y recuperación de asiento, vidas, puntos y notas.

## Decisión
Se usa **WebSocket con la librería `ws`** y un **protocolo propio**: JSON con el sobre de SPEC §4.1, validado con Zod en ambos extremos, detrás de la interfaz `Transport`. Un solo endpoint, `/ws`.

**Heartbeat y detección de conexiones caídas**
- El servidor envía un ping de WebSocket cada 15 s. Si una conexión no respondió el pong anterior, se termina con `terminate()` y el jugador pasa a `disconnected` (SPEC §3.2).
- El navegador no puede enviar pings de WebSocket, así que el cliente envía `sys.ping` cada 5 s. La respuesta `sys.pong` le sirve para medir el desfase del reloj. Si no llega en 10 s, el cliente cierra la conexión y se reconecta.
- Reconexión del cliente: espera exponencial con jitter, de 0,5 s hasta un máximo de 5 s, mientras dure el plazo de gracia. Al reconectarse presenta su ficha.

**Límite de tamaño**
- `maxPayload` de 16 KiB por mensaje entrante. Un mensaje más grande cierra la conexión con el código 1009.
- La compresión `permessage-deflate` queda **desactivada**: los mensajes son pequeños, y la compresión cuesta CPU y memoria por conexión.

**Control de saturación (backpressure)**
- Antes de cada envío se mira `socket.bufferedAmount`.
- Por encima de 256 KiB, se dejan de enviar mensajes descartables (`presence.updated`) a esa conexión.
- Por encima de 1 MiB, se cierra la conexión con el código 1013. El cliente se reconecta y recibe un snapshot, así no se pierde ningún estado.
- Los mensajes del registro nunca se descartan: se envían o se cierra la conexión.

**Abuso**
- Límite de velocidad por conexión con cubetas de tokens (SPEC §4.8).
- Comprobación del `Origin` en el handshake.
- Las conexiones sin sala se cierran a los 30 s.
- En producción solo se acepta `wss://` (ADR 0007).

**Orden**
- Cada sala tiene una cola de comandos que se procesa de a uno, y así se define "la primera que llega".
- Todo el envío a los clientes pasa por un único `RoomBroadcaster`, que aplica el inspector de filtración en las pruebas.

## Alternativas consideradas

| Criterio | `ws` + protocolo propio | Colyseus | Socket.IO |
|---|---|---|---|
| Control del formato y del versionado | Total: el sobre y los esquemas Zod son nuestros | Lo impone su sincronización de estado (`@colyseus/schema`, con parches delta) | Su propio protocolo de paquetes, con eventos sobre JSON |
| Encaje con el registro de eventos | Directo: cada evento del registro es un mensaje | Choca: hay dos fuentes de verdad, el estado sincronizado y nuestro registro | Neutro |
| Riesgo de filtrar la solución | Bajo: solo sale lo que se envía de forma explícita | Mayor: todo lo que esté en el estado sincronizado sale solo, hay que excluir la solución por diseño | Bajo |
| Validación Zod compartida | Nativa | Duplica los esquemas (decoradores de schema más Zod) | Posible, con capa propia |
| Reconexión con ficha propia | Hay que implementarla (es poco código) | Tiene `allowReconnection`, pero con su propio modelo de sesión | Tiene recuperación del estado de conexión, pero no de nuestro estado de juego |
| Heartbeat y saturación | Hay que implementarlos (`ping`, `bufferedAmount`) | Incluidos | Incluidos, con un buffer propio |
| Salas y matchmaking | Hay que implementarlos (una sala es un `Map`) | Incluidos | Hay "rooms" para difundir mensajes |
| Peso y dependencias en el cliente | Ninguno: el WebSocket del navegador | Un SDK cliente propio | Un cliente propio con varias decenas de KB |
| Escalado horizontal futuro | Con `RoomStore` en Redis y afinidad por código de sala | Con su driver y su presencia en Redis | Con un adaptador de Redis |
| Dependencia del proveedor | Mínima | Alta: servidor y cliente atados al framework | Media |

- **Colyseus** se descarta porque su modelo de estado sincronizado duplica el registro de eventos y aumenta la superficie de filtración. Lo que ahorra (salas y reconexión) es poco código en nuestro caso.
- **Socket.IO** se descarta porque agrega un protocolo y un cliente que no necesitamos. Su reconexión no restaura nuestro estado de juego, y no necesitamos el fallback a long-polling para un grupo cerrado con navegadores modernos.
- **WebTransport y WebRTC** son excesivos para hasta 6 jugadores y tienen menos soporte.

## Consecuencias
- Tenemos control total y una superficie mínima, a cambio de implementar y probar el heartbeat, la reconexión, el límite de velocidad y la saturación. Esto se suma al servidor de salas y a sus pruebas de integración.
- El `Transport` en memoria para las pruebas y el servidor simulado del cliente salen de la misma interfaz.
- Los límites se validaron con la prueba de carga (`docs/carga.md`).

## Nota del 2026-10-24: implementación
- El adaptador `ws` está en `apps/server/src/infra/ws-transport.ts`, detrás de la interfaz `Transport`; las pruebas usan un transporte en memoria con el mismo contrato.
- **Origen:** el handshake solo se acepta si `Origin` está en `ALLOWED_ORIGINS` (variable de entorno, separada por comas; en desarrollo, `http://localhost:5173`). Un origen ausente o ajeno recibe HTTP 403, y una ruta distinta de `/ws`, 404.
- **Heartbeat:** ping cada 15 s; se termina la conexión que no respondió el anterior (entre 15 y 30 s sin pong). Usa el `Clock` del servidor, así la prueba avanza un reloj falso.
- **Límites:** cubeta de comandos de 20 por segundo con ráfagas de 40 (`rate_limited`); presencia, 50 por segundo con ráfaga de 50, y ping, 2 por segundo con ráfaga de 5, descartando lo que sobra. Un mensaje binario recibe `bad_request`.
- **Cierres:** 1001 (apagado), 1009, 1012 (sala cerrada para reconstruirla, E-16), 1013, 4000, 4001 y 4002 (sin sala en 30 s). SPEC §4.4.
- En desarrollo, Vite reenvía `/ws` al servidor (proxy), así el servidor sigue en 127.0.0.1 y `ALLOWED_ORIGINS` incluye el origen de `dev:lan` solo en desarrollo.
