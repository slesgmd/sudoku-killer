# Prueba de carga (F11e)

Mide si una instancia del servidor de salas aguanta al menos 50 salas simultáneas con la latencia de una jugada por debajo de 150 ms en el p95 (criterio de F11), y cuánta memoria y CPU usa. La cifra de esta máquina **no es la de producción**: se repite en F12, en el hosting.

## 1. Cómo se ejecuta

```
pnpm --filter @sudoku-killer/server load --scenario realistic|stress [--rooms 50] [--players 6]
  [--duration 60] [--warmup 15] [--seed N] [--port 8090] [--reset-matches] [--out archivo.json]
```

- Script: `apps/server/scripts/load/load.ts`. Parámetros versionados: `apps/server/scripts/load/params.json` (versión 1); los argumentos los reemplazan.
- Necesita `DATABASE_URL` hacia una base migrada y con el banco cargado (`db:migrate` y `bank:load`). `--reset-matches` vacía `matches` y `match_events` antes de empezar, para no reconstruir las partidas de una corrida anterior, y solo se acepta con una base cuyo nombre termina en `_load`.
- El servidor corre en un proceso hijo, con el mismo punto de entrada de `pnpm dev` (`src/index.ts`, desde las fuentes) y `LOG_LEVEL=warn`. Los clientes son conexiones `ws` en el proceso del script, con el `Origin` permitido.
- No corre en cada push: se ejecuta a mano o con el workflow programado `.github/workflows/load.yml` (semanal y manual, con PostgreSQL 18 como servicio del job y el informe como artefacto).

## 2. Qué hace y qué mide

- Crea las salas una tras otra: quien crea la sala y 5 personas más, dificultad media, y empieza la partida. Al terminar una partida, quien inicia vuelve al lobby y empieza otra: la carga no decae.
- Cada jugador hace una acción cada `minGapMs`–`maxGapMs` ms, con la mezcla del escenario; antes de cada acción envía su presencia (`presence.select`), y cada 5 s un `sys.ping`, como el navegador. Los clientes no reciben la solución: la calculan con el solver del motor sobre el puzzle público.
- **Latencia de una jugada:** en el cliente, desde que envía `cell.place` hasta que recibe la respuesta con su `replyTo` (`cell.solved`, `cell.mistake`, `cell.already_solved` o un error). Incluye la cola de la sala, el group commit en PostgreSQL (el evento se confirma antes de difundirse, ADR 0004) y la red local. Solo cuentan las jugadas enviadas en la ventana de medición, después del calentamiento.
- **Servidor:** memoria residente (RSS) y CPU del proceso, de `/proc`, una muestra por segundo.
- **Generador:** el retraso del bucle de eventos del proceso de los clientes (`monitorEventLoopDelay`, resolución de 10 ms), para saber si el propio generador inflaba la latencia.
- El azar de los clientes (ritmo, celdas, acciones) sale de la semilla. El puzzle de cada partida lo elige el servidor con su propio azar, así que dos corridas con la misma semilla no son idénticas.

### Escenarios (`params.json`, versión 1)

| Escenario | Ritmo por jugador | Mezcla de acciones |
|---|---|---|
| Realista | una acción cada 2–5 s | 65 % acierto, 10 % error (si le queda más de una vida), 25 % nota personal o grupal |
| Estrés | una acción cada 50 ms: 20 comandos por segundo por conexión, el máximo sostenido de los límites (SPEC §4.8), más la presencia | 30 % acierto, 2 % error, 68 % nota |

Los dos usan 50 salas × 6 jugadores (300 conexiones), 15 s de calentamiento, 60 s de medición y la semilla 20261025.

## 3. Entorno de las mediciones (2026-10-25)

- Contenedor Linux con 4 CPU y 16 GB de memoria; **los clientes corren en la misma máquina que el servidor** y compiten con él y con PostgreSQL por la CPU.
- **PostgreSQL 16.15**, no 18: la red de esta máquina bloquea el repositorio de PGDG, así que se usó la versión del sistema (Ubuntu 24.04), como se decidió. Rol `sudoku_load` sin privilegios, base `sudoku_load` en 127.0.0.1, configuración por defecto, banco completo (2000 puzzles, 500 vigentes por dificultad). El workflow usa PostgreSQL 18.
- **Node 22.22**, no la 24 del proyecto (`.node-version`): es la que trae esta máquina.

## 4. Resultados de la primera medición

| | Realista | Estrés |
|---|---|---|
| Conexiones abiertas al final | 300 | 300 |
| Jugadas medidas | 3 704 (62 por segundo) | 72 098 (1 201 por segundo) |
| Latencia de una jugada, p50 | 12,8 ms | 22,8 ms |
| **Latencia de una jugada, p95** | **15,3 ms** | **74,2 ms** |
| Latencia de una jugada, p99 / máxima | 18,1 / 51,4 ms | 130,9 / 198,7 ms |
| Memoria del servidor (RSS): sin salas / al empezar a medir / pico / al final | 159 / 176 / 157 / 157 MB | 165 / 208 / 343 / 343 MB |
| CPU del servidor, media / pico (100 % = un núcleo) | 11,5 / 20 % | 75 / 113 % |
| Retraso del bucle del generador, p95 / máximo | 10,9 / 16,2 ms | 11,2 / 37,8 ms |
| Partidas empezadas / terminadas | 100 / 50 | 1 356 / 1 335 |
| Mensajes enviados / recibidos por los clientes | 15 609 / 66 330 | 576 102 / 1 701 234 |
| Respuestas a las jugadas | 3 268 aciertos, 432 errores, 3 `already_solved`, 1 `match.not_running` | 63 828 aciertos, 4 059 errores, 3 375 `already_solved`, 836 `match.not_running` |
| Cierres de conexión (1013 u otros) y `rate_limited` | ninguno | ninguno |

**Lectura:**
- El criterio de F11 (p95 < 150 ms con al menos 50 salas) se cumple en los dos escenarios, en esta máquina.
- El piso de unos 13 ms del p50 es la espera del group commit (`COMMIT_DELAY_MS` = 10 ms, `apps/server/src/match/sink.ts`) más la escritura en PostgreSQL: el evento se confirma antes de responder.
- El generador no infló la latencia de forma apreciable: su retraso p95 (unos 11 ms) está en la resolución del monitor.
- `match.not_running` y `already_solved` son jugadas que llegaron después del final de la partida o sobre una celda ya resuelta por otro: con 6 personas a 20 comandos por segundo, un tablero medio se resuelve en unos 3 s.
- **Para revisar en el punto de control:** en estrés, la memoria del servidor subió de 208 a 343 MB durante los 60 s de medición y terminó en su pico, con más de 1 300 partidas empezadas y terminadas. Con esta corrida no se puede distinguir una meseta de una fuga (por ejemplo, lo que la sala conserva de cada partida jugada). No se optimizó nada antes del punto de control. Se investigó en F11f (sección 6).

Todas las mediciones de este documento usaron **Node 22.22 y PostgreSQL 16.15** (sección 3).

### Ritmo real del estrés y cuello de botella

- **Ritmo real por jugador** (medido en los clientes, estrés de 5 min): 12,5 comandos por segundo (4,0 `cell.place`, 4,3 `note.add` y 4,3 `note.remove`), más 12,5 `presence.select` y 0,2 `sys.ping` por segundo. No llega a los 20 comandos por segundo del límite porque, con 6 personas a ese ritmo, un tablero medio se resuelve en unos 3 s y cada partida tiene después alrededor de 1 s sin jugadas (vuelta al lobby y partida nueva). Por instancia: unos 3 750 comandos y 3 750 mensajes de presencia por segundo, y unos 19 partidas nuevas por segundo.
- **CPU de cada proceso:** el servidor usó de media entre el 75 % y el 97 % de un núcleo, con picos de entre el 111 % y el 129 % (el hilo principal de Node más la recolección de basura y los hilos de E/S). El generador de clientes usó entre el 42 % y el 45 % de un núcleo, y su bucle de eventos se retrasó como mucho unos 11 ms en el p95. **El cuello de botella fue el servidor** (su hilo principal, cerca de un núcleo entero), no el cliente. La CPU de PostgreSQL no se midió por separado. En el escenario realista, el servidor usó un 11 % de un núcleo y el generador, un 5 %.

### Limitación de E-17 (saturación)

Ninguna medición llegó a la saturación: no hubo cierres 1013. La prueba de caos de F11c provoca E-17 **forzando el valor de bytes encolados** (`bufferedAmount`) de la conexión: el servidor toma su camino real (descarta la presencia, cierra con 1013 y el cliente se reconecta), pero **no se prueba un búfer lleno en una red real**. En una conexión local, los búferes del sistema operativo absorben varios MB antes de que `bufferedAmount` suba, y llegar a 1 MiB con los límites de velocidad llevaría minutos. Queda para observar en F12, con clientes reales sobre redes lentas.

## 5. Estado

Primera medición hecha y revisada en el punto de control del autor. F11f (sección 6): se encontró y se corrigió la memoria que retenía la caché del catálogo de puzzles; no hizo falta otra optimización.

## 6. Memoria en estrés de 5 minutos (F11f)

Método (`--memory`): el servidor corre con `--expose-gc` y el inspector de Node; el script lee `process.memoryUsage()` del servidor por el inspector. Primero mide el heap base (tras una recolección, sin salas); durante 5 min de estrés, el RSS y el heap cada 10 s; después cierra todos los clientes, espera 130 s (las salas sin nadie se borran a los 120 s, R-14; se comprobó que no quedaba ninguna partida sin terminar en la base), fuerza la recolección y vuelve a medir el heap. Con `--heap-snapshots`, guarda una instantánea del heap al empezar y otra al final.

| | Antes de la corrección | Después de la corrección |
|---|---|---|
| Partidas jugadas en los 5 min | 5 737 | 5 606 |
| Heap durante la medición (cada 10 s) | entre 75 y 102 MB, sin tendencia | entre 70 y 87 MB, sin tendencia |
| RSS durante la medición | de 214 a 260 MB, plano desde los 160 s | de 215 a 241 MB, casi plano desde los 60 s |
| Heap base, sin salas | 18,8 MB | 18,8 MB |
| **Heap tras borrar las salas y recolectar** | **52,2 MB** | **21,7 MB** |
| RSS al final / sin salas | 189 / 166 MB | 174 / 166 MB |

**Diagnóstico.** El heap no crecía de forma lineal, pero tras borrar las salas quedaba claramente por encima de la base. Una corrida de 2 min (2 351 partidas) dejó el mismo exceso que la de 5 min (53,2 MB): lo retenido no dependía de la cantidad de partidas. La diferencia entre las instantáneas mostró unas 500 estructuras de puzzle (502 `Uint8Array`, 498 cadenas `medium` y unos 180 000 arreglos): los 500 puzzles medios del banco. La causa: el catálogo (`apps/server/src/puzzles/catalog.ts`) guardaba en un `Map` sin tope cada puzzle jugado, y mientras el puzzle vive, el `WeakMap` del calificador del motor (`packages/engine/src/grader/context.ts`) conserva su contexto, de unos 70–80 KB. No era una fuga por partida, pero la memoria crecía con los puzzles distintos jugados, hasta unos 160 MB con el banco completo (2 000 puzzles).

**Corrección.** La caché del catálogo es ahora una LRU de 64 puzzles (`CATALOG_CACHE_ENTRIES`). Las partidas en curso conservan su puzzle aunque salga de la caché, y lo que sale se vuelve a leer de la base al empezar otra partida o al reconstruir. Prueba: `apps/server/test/catalog.test.ts`, que falla sin la corrección (el puzzle menos usado nunca se volvía a leer).

**Latencia después de la corrección** (corridas normales de 60 s, como las de la sección 4): estrés, p95 de 49,3 ms (p99 de 85,8 ms y máximo de 144,1 ms; antes, 74,2 ms) y pico de RSS de 295 MB (antes, 343 MB); realista, p95 de 15,2 ms (antes, 15,3 ms). En las corridas de 5 min con el inspector conectado, el p95 de estrés fue de 39,9 ms antes y de 102,3 ms después, con la CPU media del servidor en el 83 % y el 97 %. Entre corridas, la latencia de estrés de esta máquina varía más que esa diferencia, y con 64 puzzles en caché cada partida nueva puede recalcular el contexto del calificador: en estrés empiezan unas 19 por segundo, y en un uso real, muy pocas. Se vuelve a medir en F12, en el hosting.

## 7. Logs y métricas en producción (F12h)

El servidor escribe una línea JSON por entrada en la salida estándar, que el panel de Render muestra como log del servicio. Cada 60 s escribe una línea `metrics` con estos campos, todos recuentos o tiempos. Nunca lleva códigos de sala, apodos, fichas, claves ni direcciones IP (prueba `apps/server/test/metrics.test.ts`).

| Campo | Qué es |
|---|---|
| `uptimeS` | Segundos desde el arranque (un valor bajo delata un reinicio o un despertar). |
| `connections` / `addresses` | Conexiones abiertas y cuántas direcciones distintas las abren (para confirmar `TRUST_PROXY_HOPS` en F12j: con dos redes distintas, 2). |
| `rooms` / `matchesRunning` / `playersConnected` | Salas en memoria, partidas en curso y jugadores conectados. |
| `commits` / `events` / `commitP95Ms` / `commitMaxMs` | Escrituras en la base del período, eventos escritos y su duración (la espera que suma cada jugada, ADR 0004). |
| `eventLoopP95Ms` | Retraso del bucle de eventos en el p95 (con 0,1 CPU, la primera señal de saturación). |
| `rssMb` / `heapUsedMb` | Memoria del proceso (el plan gratuito tiene 512 MB). |
| `accessDenied` | Claves ofrecidas que no valen en el período (401 en `POST /access` o 4003, R-39): un número alto es alguien probando claves. La prueba de humo suma una por corrida (T-39.17). |
| `accessMissing` | Comprobaciones y conexiones sin clave en el período (401 en `POST /access` o 4003, R-39): navegadores que todavía no la tienen; no cuentan para la espera por IP (T-39.7, T-39.11). En el log, cada una deja `websocket access key missing` (nivel info), y cada clave que no vale, `websocket access denied` (warn). |
| `accessLocked` | Handshakes y `POST /access` con 429 en el período: una red que agotó sus 10 intentos y vuelve a ofrecer una clave (T-39.3). |
| `addressUnknown` | Handshakes en el período cuya IP no se pudo saber (T-39.8): si no es 0, `TRUST_PROXY_HOPS` no coincide con lo que manda el proxy (el primer caso deja en el log `client address unknown` con el número de entradas de `X-Forwarded-For`, nunca su contenido). |

Desde F12, estas líneas reemplazan la prueba de carga en el hosting (sección 8).

## 8. Carga en el hosting: desviación aprobada (F12k)

El plan pedía repetir la prueba de carga en Render con 1, 3 y 5 salas y un p95 menor que 150 ms desde Actions. El autor aprobó el 2026-10-25 no hacerla con bots y reemplazarla por la línea `metrics` de producción durante la beta de F13. Motivos:
- El plan gratuito: 0,1 CPU y 512 MB compartidos con las partidas reales; una carga sintética mide sobre todo ese límite y puede tumbar la instancia del grupo.
- No exponer la clave del grupo en GitHub: los bots necesitarían un secreto con ella en un repositorio público.
- No mezclar partidas de bots con las reales, que `scoring:report` analiza en F13 (el registro de eventos es de solo agregar, ADR 0004).

Qué se mira en F13, en el log de Render, con las partidas reales: `commitP95Ms` y `commitMaxMs` (la espera de la base en cada jugada), `eventLoopP95Ms` (la primera señal de saturación con 0,1 CPU) y `rssMb` y `heapUsedMb` (frente a los 512 MB), junto con `rooms`, `playersConnected` y `connections` para saber con cuánta carga se midió. Los valores de referencia son los de la sección 4, en local. Si en la beta el p95 de la base o del bucle se acerca a 150 ms, o la memoria a 512 MB, se registra en la BITÁCORA y se decide con el autor.
