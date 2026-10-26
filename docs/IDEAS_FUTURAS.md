# Ideas futuras (fuera de la v1)

Todo lo que no entra en la v1 se registra aquí. No se implementa hasta que se priorice para una versión posterior (la priorización para la v2 se hace en F13).

Formato de cada entrada: título, descripción breve, origen (fecha y contexto) y notas.

---

## 1. Modo competitivo entre amigos

- **Descripción:** modo en el que los jugadores compiten entre sí en lugar de cooperar en un mismo resultado grupal. Se implementará como un nuevo módulo `GameMode`, sin reescribir el resto del sistema (ver principio 4 de la arquitectura en `PLAN.md`).
- **Origen:** 2026-10-22, decisión de alcance del plan 1.01 (se movió fuera de la v1).
- **Notas:** por definir reglas, puntuación y condiciones de victoria.

## 2. Ranking acumulado de la sala

- **Descripción:** sumar los puntos de varias partidas seguidas en la misma sala, con una tabla de la sesión además del ranking de cada partida.
- **Origen:** 2026-10-22, F2 (P4). La v1 tiene un ranking por partida.
- **Notas:** el registro de eventos (ADR 0004) ya permite calcularlo a partir de las partidas guardadas.

## 3. Chat y reacciones rápidas

- **Descripción:** un chat de texto o reacciones predefinidas dentro de la sala.
- **Origen:** 2026-10-22, F2 (P8). En la v1 se asume que el grupo usa voz externa.
- **Notas:** requiere moderación básica y un límite de velocidad propio; no entraría en el registro de la partida.

## 4. Modo contrarreloj

- **Descripción:** un límite de tiempo por dificultad, con derrota si se agota.
- **Origen:** 2026-10-22, F2 (P9). En la v1 el cronómetro no tiene límite.
- **Notas:** encaja como parámetro de un `GameMode` (`outcome` con tiempo).

## 5. Identidad persistente del jugador

- **Descripción:** una identidad que sobreviva al borrado de los datos del navegador (cuentas opcionales o un código personal), para que la regla D3 (volver sin 3 vidas nuevas) no se pueda evitar.
- **Origen:** 2026-10-22, F2 (limitación aceptada de D3 para un grupo cerrado).
- **Notas:** el plan de la v1 excluye las cuentas de usuario.

## 6. Tema oscuro

- **Descripción:** una paleta oscura con los mismos tokens (`tokens.css`), elegida por `prefers-color-scheme` o desde los ajustes.
- **Origen:** 2026-10-24, cierre de F8 (pendiente de `design/entrega-f8.md` §4). El prototipo de F7 solo diseña el tema claro, y se decidió dejarlo fuera de la v1.
- **Notas:** hay que medir otra vez toda la matriz de contrastes (`docs/diseno.md` §2.5), incluidas las líneas de jaula y los colores de jugador, y revisar las sombras y la marca de GitHub del inicio, que pasaría a blanco.

## 7. Historial de actividad en el snapshot

- **Descripción:** sumar al snapshot (SPEC §4.5) las últimas 50 jugadas públicas de la partida en curso (aciertos, errores y pistas, con `seq`, autor, celda, dígito revelado o propuesto y hora), como campo opcional. Así, tras reconectar o recargar, la actividad muestra lo que pasó antes en lugar del aviso de R-38. **Nunca** las notas personales (R-29), ni tampoco las grupales.
- **Origen:** 2026-10-25, punto de control de F10 (F10h). En la v1, el snapshot no trae el historial y la actividad empieza con «La actividad anterior a la reconexión no está disponible.» (R-38).
- **Costo estimado:**
  - Protocolo: un campo opcional (`recentActivity?`), sin subir la versión (§4.7). Unos 80 bytes por entrada en JSON, unos 4 KB por bienvenida con 50 entradas, dentro de los límites de §4.8.
  - Servidor: derivar las entradas de la cola del registro (`cell.solved`, `cell.mistake`, `hint.used`), sin guardar nada nuevo, así también salen igual tras una reconstrucción. Una función pura en `packages/game`, al lado de `snapshotFor`.
  - Cliente: reemplazar la actividad por esas entradas al recibir el snapshot, sin duplicar las que llegan después (por `seq`).
  - Pruebas: el inspector de filtración sobre la bienvenida (sin notas personales ni dígitos no revelados en `value`), una prueba de integración tras un reinicio y una de componente. En total, unas 1–1,5 h.
- **Notas:** los avisos locales (toasts) del historial anterior se pierden igual, porque son del cliente.

## 8. Tiempos reales por nivel de celda, T(L)

- **Descripción:** medir T(L), el tiempo que lleva resolver una celda de nivel L, con partidas reales, para reemplazar el supuesto del modelo del mundo de la puntuación (`docs/puntuacion.md`, secciones 10 y 11). La medida directa necesita el momento en que un jugador selecciona la celda, que hoy solo viaja como presencia y no se guarda.
- **Origen:** 2026-10-25, plan de F11. Se decidió no agregar un evento de selección al registro en la v1: T(L) queda fuera.
- **Alternativa sin cambiar el registro:** estimarlo con el tiempo entre jugadas de un mismo jugador (`at` de sus `cell.solved` y `cell.mistake` consecutivos), que ya está en el registro, agrupado por el `level` de la celda resuelta. Es una cota superior ruidosa (incluye el tiempo que el jugador dedicó a otras celdas y a las notas), pero sirve para comparar los perfiles del simulador. `scoring:report` (F11) puede calcularla.
- **Costo de la medida directa:** un evento de selección solo en el servidor, sin difusión (SPEC y ADR 0004), con su volumen en la base (la presencia llega hasta 10 veces por segundo por jugador; habría que guardar solo la primera selección de cada celda), unas 1–2 h.
