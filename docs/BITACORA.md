# Bitácora

Historial detallado del proyecto: qué se hizo, problemas, soluciones y tiempo real dedicado. Entradas en orden cronológico (la más reciente al final). No se carga automáticamente; se consulta cuando hace falta.

---

## 2026-10-22 — F0: Entorno y arranque

**Hecho:**
- Plan actualizado a la versión 1.02: en F1 la referencia a la skill "rea-guia" se reemplazó por la skill oficial `reverse-engineer-anything`, con la indicación de verificar con `binary_session` las herramientas de navegador.
- Entorno verificado:
  - Node v24.21.0
  - pnpm 12.12.1
  - Git 2.54.0.windows.1 (usuario global configurado)
  - REA (servidor MCP `rea-agents`) 6.7.0: `binary_session` responde; `inspect_web_page` y `capture_browser_scenario` disponibles (`available: true`). Los proveedores de ADB no están disponibles (no hacen falta para la v1).
- `git init` con rama `main` y `.gitignore` (dependencias, builds, cobertura, `.env`, evidencia local de REA, archivos de editores y del sistema operativo).
- Creados `CONTEXTO.md`, `docs/BITACORA.md`, `docs/IDEAS_FUTURAS.md` (primera entrada: modo competitivo) y `docs/adr/README.md` (plantilla e índice).
- Primer commit.

**Problemas y soluciones:**
- `git config --global init.defaultBranch` no estaba definido. Se usó `git init -b main` y no se cambió la configuración global.
- Git avisaba de conversiones LF→CRLF porque `core.autocrlf` está activo en Windows. Se agregó `.gitattributes` con `* text=auto eol=lf` para que el repositorio sea consistente con la CI de Linux (F3).
- La salida de `binary_session` es muy grande (unos 68 000 caracteres). Para consultarla conviene filtrar `tool_availability.groups` por nombre de herramienta en lugar de leerla entera.

**Tiempo real:** unos 0,1 h, ejecutado en una sola sesión, sin contar la revisión del usuario.

**Siguiente:** F1, estudio de referencia con REA. Hay que empezar en modo plan y proponer las subtareas.

## 2026-10-22 — F0: verificación de criterios de aceptación

- Revisados: `docs/IDEAS_FUTURAS.md` (el modo competitivo es la primera entrada), `docs/adr/README.md` (versionado) y las horas reales de F0 en el plan (~0,1 h). Todo estaba en orden.
- Corregido: el estado de F0 en el plan decía "Terminada" en lugar de "Hecha". Se cambió en la tabla de fases, en el estado global y en la sección de F0.

## 2026-10-22 — F1: Estudio de referencia con REA

**Hecho:**
- Verificación de REA con `binary_session`: `rea-agents` 6.7.0 (paquete y servidor), cliente MCP. `inspect_web_page`, `capture_browser_scenario` e `inspect_web_network_capture` disponibles.
- Subtareas propuestas en modo plan y aprobadas con cambios del usuario: usar siempre `/es/killer`, agregar los puntos propios del killer (sumas de jaula, resaltado de jaula, contador de dígitos, limpieza de notas) y exportar la evidencia a `evidence/f1-referencia.json`.
- F1.1: Chrome sin interfaz, con perfil temporal en el scratchpad y CDP en `127.0.0.1:9333`. `inspect_web_page` pasivo sobre `/es/killer` (E1).
- F1.2: `export_web_scripts` (E2) y lectura estática del bundle `ref-game.8da14029.js`. Resultados: niveles iniciales incluidos en el bundle y luego `/api/level/{dificultad}?mode=killer`; formato `{id, mission, solution, cages, win_rate}`; sumas de jaula calculadas en el cliente; validación en el navegador; fórmula de puntuación basada en velocidad.
- F1.3: escenario A (E3). La carga en frío confirmó que la primera partida no pide nada a la API. La navegación a experto superó los 45 s y no se completó.
- F1.4: escenario B (E4), 29 pasos sobre el nivel fácil inicial, cuya solución estaba en el bundle. Se vieron: errores 0/3 → 3/3 y aviso de fin de partida, temporizador detenido, tecla del dígito completo deshabilitada, puntuación +5/+50/+50 y pistas iniciales 3.
- F1.5 (notas, deshacer, pista, pausa) no se ejecutó. Lo que faltaba quedó marcado en `docs/referencia.md` como visto en el código o inferido, y se listaron 14 preguntas abiertas.
- `docs/referencia.md` escrito. Evidencia exportada a `evidence/f1-referencia.json` (4 registros). `evidence/` agregado a `.gitignore`.
- Plan 1.03: pregunta abierta de pistas en F2 y modelo de comparación basado en velocidad en la simulación de F6.

**Problemas y soluciones:**
- `inspect_web_page` no navega: solo observa una pestaña ya abierta. Se lanzó un Chrome propio con perfil temporal y se abrió la pestaña con `PUT /json/new`.
- Las respuestas de `capture_browser_scenario` superan el límite del transporte MCP (unos 10 MB) por el tráfico de publicidad. La evidencia queda guardada en REA: se exporta con `export_evidence_bundle` y se lee con scripts de Node en el scratchpad.
- La carga de la página tarda unos 100 s por la publicidad. Hay que usar `wait_for` sobre `#game canvas` con límites de tiempo amplios.
- El tablero es un `<canvas>` y REA guarda los valores de storage como hashes. Notas y resaltado no se pueden observar sin capturas de pantalla, que se descartaron porque el entregable no las admite.
- Dos cargas seguidas fallaron: en modo launch con storage precargado ("Scenario navigation failed…") y en modo connect, con el HTML bloqueado (`net::ERR_BLOCKED_BY_RESPONSE`). No se sabe si es un límite del sitio o un problema de la herramienta. El usuario decidió no hacer más cargas automáticas.
- Falta el dato del usuario: pidió agregar "3 respuestas" como observaciones manuales, pero en el mensaje quedó el texto de plantilla. La sección 15 de `referencia.md` queda pendiente.

**Tiempo real:** unos 0,6 h, ejecutado en una sesión, sin contar la revisión del usuario.

**Siguiente:** agregar las 3 observaciones manuales del usuario a `docs/referencia.md` (sección 15). Después, F2 en modo plan.

## 2026-10-22 — F2: Especificación y arquitectura

**Hecho:**
- F2.0: la sección 15 de `referencia.md` quedó marcada como "Descartada: las reglas propias ya cubren estos puntos" y se quitó el pendiente de `CONTEXTO.md` (commit aparte).
- Subtareas propuestas en modo plan. Las preguntas de producto se hicieron **en una sola ronda**, nueve preguntas (P1–P9) y once decisiones por defecto (D1–D11), cada una con su opción recomendada. El usuario aceptó todo con estos cambios:
  - P1: la pista le cuesta −H a quien la usa.
  - P7: deshacer una nota grupal solo se aplica si nadie la modificó después.
  - D3: quien sale y vuelve con ficha recupera vidas y puntos, y nunca vuelve con 3 vidas nuevas.
  - D6: redacción precisa.
  - Al aprobar el plan agregó dos correcciones: el apodo queda reservado hasta el fin de la partida, y el estado "salió" se suma al eje de conexión.
- `docs/SPEC.md`:
  - Decisiones de producto y resolución con dueño de las 15 preguntas abiertas.
  - Modelo de datos y máquinas de estado. La del jugador se modela en dos ejes independientes, rol y conexión.
  - Protocolo v1 con sobre, catálogo, errores, snapshot, idempotencia, versionado y límites.
  - Interfaz `GameMode`.
  - 34 reglas (R-01 a R-34) con sus casos T-xx, 24 casos límite y un plan de pruebas con inspector de filtración y matriz de cobertura.
- ADR 0001–0005 escritos y aceptados, con el índice en `docs/adr/README.md`.
- `IDEAS_FUTURAS.md`: se agregaron el ranking acumulado, el chat y las reacciones, el contrarreloj y la identidad persistente.
- Plan 1.04: F2 hecha, paquete `packages/game` y ajustes en F3, F4, F6 y F9.

**Problemas y soluciones:**
- Había dos huecos entre reglas, pero ninguna contradicción.
  - Un jugador que **expira** y vuelve con su ficha recibiría 3 vidas nuevas según la regla de "entrada con partida en curso", y eso se podía aprovechar desconectándose 2 minutos. Se resolvió como en D3: recupera sus datos, y el plazo de 2 minutos solo garantiza el asiento (D3' en la SPEC). El usuario lo confirmó al aprobar el plan.
  - El usuario mencionó una "regla 9" para la celda bloqueada. Se interpretó como la regla de celda bloqueada / "ya resuelta", que en la SPEC es R-05.
- La cadena lineal de estados del jugador del plan (`activo → espectador → desconectado → expirado`) no representa a un espectador desconectado. Se separó en dos ejes y quedó documentado como un refinamiento.
- El reductor de la partida tiene que ser compartido por el servidor, la reconstrucción y el servidor simulado del cliente (F8), y no encajaba en `engine` ni en `scoring`. Se creó `packages/game` (ADR 0004).

**Tiempo real:** unos 0,4 h (12:39 a 13:05 aproximadamente), ejecutado en una sesión. Incluye la ronda de preguntas, pero no el tiempo de revisión del usuario.

**Siguiente:** F3, monorepo y calidad, en modo plan.
