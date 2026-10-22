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
