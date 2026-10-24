# Entrega de F7 a F8

F7 cerró el 2026-10-23 con el prototipo en `design/prototipo/` (4 páginas y 51 artboards), la guía de estilo en `docs/diseno.md` y las pantallas y flujos en `design/pantallas.md`. F8 implementa este diseño en `apps/web`. **El HTML del prototipo no se corrige:** las decisiones de abajo lo enmiendan y se aplican al implementar.

## 1. Cómo usar el prototipo

- `npx serve design/prototipo` y abrir la URL que indica. El índice agrupa los artboards por página y fila, y abre cada uno en un marco de su tamaño (`marco.html`).
- Cada artboard es un `.dc.html` con su plantilla y su lógica de ejemplo. `support.js` es un motor mínimo que solo sirve para verlos; **no se reutiliza en `apps/web`**. Los componentes se reescriben en React con los tokens.
- Se pueden reutilizar tal cual los valores de `tokens.css` y, como referencia, las reglas de `board.css`, `ui.css`, `screens.css` y `game.css`. Las fuentes woff2 y sus licencias están en `design/prototipo/fonts/`.
- La barra oscura «Controles de prueba» no forma parte de la interfaz.
- Las disposiciones del prototipo se eligen con clases (`.pg--movil`, `.L-movil`, …). En producción son media queries (`docs/diseno.md`, sección 8).

## 2. Decisiones tomadas

Variante, tipografía y ajustes de contraste ya resueltos en el prototipo:
- **Variante A del tablero (franja superior reservada): elegida.** La **variante B** (la fila 1 · 2 · 3 de notas se corre a la derecha de la suma) queda **descartada**: a 37 px, la suma ocupa la casilla del 1 y, para no chocar, la fila 1 · 2 · 3 tiene que moverse, así que las notas pierden su posición fija. Se conserva en la hoja de celdas solo como referencia.
- **Inter** para toda la interfaz y el tablero; **Newsreader** solo en titulares de 24 px o más. **IBM Plex Sans queda de reserva:** también OFL y con el 1 con base, pero tras la prueba en celular Inter distingue el 1 y el 7 por dos rasgos y se mantiene a 10 px. No se usa en la interfaz.
- Acentos ajustados para llegar al mínimo de contraste (accent, success, danger e info) y pares prohibidos marcados en la matriz (`docs/diseno.md`, sección 2.5).
- Solo tema claro.

Correcciones al prototipo, decididas al cerrar F7:

1. **Ajustes solo está disponible dentro de una sala** (lobby, partida y resultados), porque `settings.update` exige ser miembro (SPEC §4.2). Se quita el botón de Inicio y de Entrar; en Ayuda, solo aparece si se abrió desde una sala.
2. **El aviso de que el derecho de iniciar pasa a otra persona solo aparece si quien sale tiene ese derecho.** Vale para todos los diálogos de salida. En el lobby y en Resultados el prototipo ya lo condiciona; la tabla de estados lo daba por general.
3. **«Volver a la sala» lleva a la pantalla que corresponde al estado de la sala:** lobby (`waiting`), partida (`running`) o resultados (`finished`). El prototipo siempre enlaza a la partida.
4. **Los avisos breves duran 6 s y se pausan con el cursor encima o con el foco.** Se aceptan frente a WCAG 2.2.1 (tiempo ajustable) porque la información queda en el registro de actividad y en la lista de jugadores. En el prototipo los avisos son fijos.
5. **Deshacer «Borrar notas» agrupa varios `note.undo` del lado del cliente** y resume el resultado («Se recuperaron X de Y notas»). El protocolo no cambia.
6. **El anillo de mismo dígito se verifica en un celular real durante F8.** Si a 360 px llena la celda (dígito de 19 px con un anillo del 130 %), se reduce.
7. **La variante B y IBM Plex Sans quedan descartada y de reserva**, con los motivos de arriba.

## 3. Prioridad para F8

F8 pide tablero, entrada de números, notas por capas con selector de vista y de escritura, vidas, temporizador y ajustes, con un servidor simulado de un jugador. Orden propuesto:

| Prioridad | Qué | Artboards de referencia |
|---|---|---|
| 1 | Tokens, fuentes, foco, utilidades (`tnum`, `sr-only`) y movimiento reducido | Tokens y contrastes; Tipografía |
| 1 | Tablero: celda, jaulas, suma, notas, todos los estados y la tabla de prioridad; foco itinerante y etiquetas | Tablero; Celdas |
| 1 | Pantalla de partida en las cuatro disposiciones: cabecera, tablero, modo, capas, visibilidad, teclado con contadores, herramientas y lupa | Partida · 1280, 768, 360 y horizontal |
| 1 | Atajos de teclado (flechas, 1–9, N, G, Supr, Ctrl+Z, H, Esc) | Celdas (atajos); Ayuda |
| 1 | Jugadores con vidas y puntos (lista y franja), cronómetro y registro de actividad | Partida |
| 1 | Ajustes (diálogo) | Diálogo de ajustes; Ajustes · 360 |
| 2 | Estados que el modo simulado puede producir: carga inicial, pendiente, error propio con destello, paso a espectador, confirmación de pista, ya resuelta, partida terminada, confirmación de salida | Estados en la partida |
| 2 | Componentes base: botones, segmentado, avisos (banner, breve, integrado), diálogo con foco atrapado | Todas |
| 3 | Inicio, Entrar o crear, Lobby, Resultados y Ayuda | Página «Pantallas» |
| 3 | Estados de red: reconectando, servidor no disponible, otra pestaña, versión, demasiadas acciones, no permitida, no se pudo deshacer, recuperadas | Estados (se completan en F10) |

## 4. Pendientes

No resueltos por el prototipo; se deciden en F8 o en la fase que se indica. Al cerrar F8 (2026-10-24), los que siguen abiertos pasan a F10, como tarea con su criterio de aceptación (`docs/PLAN.md`, F10), salvo el tema oscuro, que queda fuera de la v1:
- **Fotos:** son marcadores. Elegirlas y registrar fuente y licencia en `design/fotos.md`. **Pasa a F10.**
- **Pantallas fuera de la partida entre 600 y 1023 px:** el prototipo solo dibuja móvil y escritorio. **Pasa a F10.**
- ~~**Aviso de traspaso en la salida durante la partida**~~: resuelto en F8. Se agrega, con la condición de la decisión 2.
- **Transiciones que no están dibujadas:** de «Entrando…» al lobby, del lobby a la partida para quienes esperan, de la partida a Resultados (automática o solo con «Ver resultados»), de Resultados al lobby para los demás, llegada directa a una partida en curso, vuelta con ficha a una sala llena y regreso al estado normal tras reconectar. **Pasan a F10.** F8 resolvió solo la de un arranque que falla: aviso con «Reintentar» en lugar de «Entrando…» para siempre (R-37).
- ~~**Foco inicial de Ajustes**~~: resuelto en F8. Va al primer interruptor, y al cerrar cualquier diálogo el foco vuelve al control que lo abrió (`docs/diseno.md`, sección 7).
- ~~**Área táctil de la celda a 360 px**~~: verificada en el celular en el punto de control de F8, junto con el anillo (decisión 6) y las notas de 8 px con la lupa. Se mantienen sin cambios.
- **«Compartir»** en el lobby: no tiene comportamiento definido (por ejemplo, la hoja de compartir del sistema con un enlace a la sala). **Pasa a F10.**
- ~~**Asignación de colores de jugador**~~: resuelta en F8. El asiento N usa `--player-(N + 1)` (`docs/diseno.md`, sección 2.4).
- ~~**Tema oscuro**~~: queda fuera de la v1, en `docs/IDEAS_FUTURAS.md` (sección 6).
- ~~**Atajos de teclado**~~: implementados en F8 y validados por el usuario en el punto de control.

## 5. Lista de comprobación de F8

- [x] Los tokens de `tokens.css` son la única fuente de colores, tipografía, espaciado, radios, sombras y tiempos. Una prueba (`tests/web-tokens.test.ts`) falla con un color literal o una familia tipográfica fuera de los tokens. Las medidas fijas del tablero (la separación de 3 px de la jaula, por ejemplo) siguen el CSS del prototipo. F8 agregó dos tokens: `--cage-width` y `--cage-width-selected`.
- [x] Inter y Newsreader se sirven en local (woff2) con su licencia OFL; nada en base64 dentro del HTML.
- [x] Ningún par de colores marcado con ✕ en la matriz se usa en la interfaz.
- [x] Cada estado de la celda se distingue sin color y respeta la tabla de prioridad.
- [x] El tablero es una cuadrícula con foco itinerante, `aria-selected` y la etiqueta completa de cada celda.
- [x] Todos los atajos funcionan y la partida se puede jugar entera con teclado.
- [x] Los diálogos atrapan el foco, cierran con Esc cuando tienen cancelar y empiezan en la acción segura.
- [x] Los avisos usan `role="status"` o `role="alert"` según la tabla de estados, duran 6 s y se pausan con el cursor o el foco (decisión 4).
- [x] Con `prefers-reduced-motion` no hay sacudida ni puntos animados.
- [x] Las cuatro disposiciones de la partida se ven bien a 1280, 768, 360 y 740 × 360, sin desplazamiento horizontal de la página. También a 320 y 1920, y en WebKit con el tamaño de un iPhone (390 × 844) y de un iPad (820 × 1180 y 1180 × 820).
- [x] Ajustes solo aparece dentro de una sala (decisión 1).
- [x] El aviso de traspaso solo aparece si quien sale tiene el derecho (decisión 2).
- [ ] «Volver a la sala» va al lobby, a la partida o a resultados según el estado (decisión 3). **Pasa a F10:** F8 no tiene lobby ni resultados, y la partida terminada vuelve al inicio.
- [x] Deshacer «Borrar notas» agrupa los `note.undo` en el cliente (decisión 5).
- [x] Anillo de mismo dígito, área táctil y notas de 8 px revisados en un celular real (decisión 6), en el punto de control: sin cambios.
- [x] Los textos de la interfaz están preparados para i18n y coinciden con los del prototipo.
- [x] Revisión de originalidad repetida si el diseño cambia (`docs/diseno.md`, T-18.1): hecha al cerrar F8 para los cambios del punto de control y de la prueba con el bot.
