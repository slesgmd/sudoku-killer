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

## 3. Entorno de la primera medición (2026-10-25)

- Contenedor Linux con 4 CPU y 16 GB de memoria; **los clientes corren en la misma máquina que el servidor** y compiten con él y con PostgreSQL por la CPU.
- **PostgreSQL 16.15**, no 18: la red de esta máquina bloquea el repositorio de PGDG, así que se usó la versión del sistema (Ubuntu 24.04), como decidió el usuario. Rol `sudoku_load` sin privilegios, base `sudoku_load` en 127.0.0.1, configuración por defecto, banco completo (2000 puzzles, 500 vigentes por dificultad). El workflow usa PostgreSQL 18.
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
- **Para revisar en el punto de control:** en estrés, la memoria del servidor subió de 208 a 343 MB durante los 60 s de medición y terminó en su pico, con más de 1 300 partidas empezadas y terminadas. Con esta corrida no se puede distinguir una meseta de una fuga (por ejemplo, lo que la sala conserva de cada partida jugada). No se optimizó nada antes del punto de control.

## 5. Estado

Primera medición hecha; **punto de control del usuario pendiente** antes de cualquier optimización (F11f).
