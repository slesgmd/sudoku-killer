# Guía de estilo — Sudoku Killer (F7)

Fuente: el prototipo de `design/prototipo/` (4 páginas y 51 artboards; índice en `design/prototipo/index.html`, se abre con `npx serve design/prototipo`). Esta guía describe lo que el prototipo resuelve. Lo que no resuelve figura como **pendiente**, y las correcciones decididas al cerrar F7 están en `design/entrega-f8.md` («Decisiones»), que se aplican en F8.

Documentos relacionados:
- `design/pantallas.md`: cada pantalla y los flujos.
- `design/entrega-f8.md`: decisiones, prioridades para F8, pendientes y lista de comprobación.
- `design/fotos.md`: registro de fuente y licencia de las fotos.

---

## 1. Principios

1. **Un tablero, varias cabezas.** El tablero es el centro de la pantalla. Todo lo demás (jugadores, actividad, controles) lo acompaña sin competir con él.
2. **Tono sereno y editorial.** Gama tierra y piedra, poco contraste entre superficies, un solo acento (verde oliva) y titulares con serifa. Nada de colores saturados, degradados ni ilustraciones decorativas.
3. **La forma antes que el color.** Cada estado se reconoce sin color: tachado e inicial en el error, subrayado en las notas personales, negrita en las grupales, esquina doblada en la pista, tres puntos en la espera, contorno discontinuo en lo inactivo o desconectado.
4. **Cooperación visible.** Siempre se ve quién hizo qué: inicial del autor del error, presencia de los compañeros en sus celdas y registro de actividad con monograma.
5. **Calma ante los fallos de red.** Los estados transversales explican qué pasa, qué se conserva y qué queda bloqueado, sin alarmar (sección 9).
6. **Accesible por defecto.** Contraste AA medido, teclado completo, lectores de pantalla y movimiento reducido (sección 7).

## 2. Tokens

Definidos en `design/prototipo/tokens.css`. Solo hay **tema claro**. El tema oscuro queda fuera de la v1 (`docs/IDEAS_FUTURAS.md`, sección 6).

### 2.1 Superficies y texto

| Token | Valor | Uso |
|---|---|---|
| `--canvas` | `#F3F0E8` | Fondo de página |
| `--surface` | `#E7E1D6` | Controles en reposo, teclas, marcadores de foto |
| `--paper` | `#FAF8F2` | Paneles, tablero, diálogos |
| `--ink` | `#25251F` | Texto, dígitos, líneas de caja, foco |
| `--muted` | `#66655C` | Texto secundario, dígito pendiente |
| `--border` | `#D1CCBF` | Divisores decorativos y líneas de celda (no portan información) |

### 2.2 Acentos funcionales

Los valores propuestos no llegaban al mínimo sobre alguna superficie o tinte y se ajustaron:

| Token | Propuesto (peor caso) | Ajustado (referencia) | Restricción de uso |
|---|---|---|---|
| `--accent` | `#62684B` (4,48 sobre surface) | `#5D6347` (4,83 sobre surface) | Selección propia, botón principal, notas personales |
| `--success` | `#53765B` (3,93 sobre surface) | `#4F7357` (5,04 sobre paper) | Nunca como texto sobre surface, selection-tint ni danger-tint |
| `--danger` | `#B44F45` (3,99 sobre selección) | `#A6463D` (4,64 sobre selección) | Errores, acción destructiva |
| `--info` | `#6C8490` (3,02 sobre surface) | `#647C88` (3,38 sobre surface) | Solo iconos y gráficos, nunca texto |

### 2.3 Tablero

| Token | Valor | Uso |
|---|---|---|
| `--cell-line` | `= border` | Línea de celda, 1 px |
| `--box-line` | `= ink` | Línea de caja, 2 px |
| `--cage-line` | `#827968` | Jaula: línea discontinua a 3 px del borde |
| `--cage-width` | `2px` | Grosor de la línea de jaula (F8: 1 px en F7, 1,5 px en el punto de control y 2 px tras la prueba con el bot) |
| `--cage-width-selected` | `3px` | Grosor en la jaula de la celda seleccionada (F8: 2 px en F7, después 2,5 px y 3 px) |
| `--selection-tint` | `#E3E6D4` | Celda propia (con borde accent de 2 px) |
| `--related-tint` | `#EFEDE2` | Fila, columna, caja y jaula de la celda seleccionada |
| `--danger-tint` | `#F7E6E1` | Fondo del error durante el destello |

### 2.4 Jugadores

Seis colores derivados de la gama tierra y piedra, con luminancias parecidas para que ninguno destaque. **Siempre van con monograma o inicial**, nunca solos. Ninguno usa el verde oliva del acento, que queda reservado a la selección propia.

| Token | Valor | Nombre | Inicial en paper encima |
|---|---|---|---|
| `--player-1` | `#4A6779` | pizarra | 5,64:1 |
| `--player-2` | `#9A5338` | arcilla | 5,39:1 |
| `--player-3` | `#7A4E69` | ciruela | 6,34:1 |
| `--player-4` | `#7F6420` | ocre | 5,28:1 |
| `--player-5` | `#3F6B5B` | pino | 5,71:1 |
| `--player-6` | `#585A85` | índigo | 6,15:1 |

Como contorno de presencia sobre selection-tint: 4,41:1 o más.

**Asignación por asiento (resuelta en F8):** el asiento N (de 0 a 5) usa `--player-(N + 1)`, en el orden de la tabla. El color sigue al asiento actual. Si el jugador queda sin asiento (salió o expiró), conserva el color del último que tuvo, así sus entradas del registro de actividad no cambian de color.

### 2.5 Contrastes medidos

Medidos con la fórmula de luminancia relativa de WCAG 2.2. Mínimos: texto 4,5:1; componentes, líneas de jaula e iconos 3:1. Los pares marcados con ✕ no llegan al mínimo de su fila y **quedan prohibidos** en la interfaz.

| Primer plano (mínimo) | paper | canvas | surface | selección | relación | error |
|---|---|---|---|---|---|---|
| ink (texto 4,5) | 14,51 | 13,53 | 11,84 | 12,13 | 13,12 | 12,74 |
| muted (texto 4,5) | 5,52 | 5,15 | 4,51 | 4,62 | 4,99 | 4,85 |
| accent (texto 4,5) | 5,92 | 5,52 | 4,83 | 4,95 | 5,35 | 5,20 |
| danger (texto 4,5) | 5,55 | 5,17 | 4,53 | 4,64 | 5,02 | 4,87 |
| success (texto 4,5) | 5,04 | 4,70 | ✕ 4,11 | ✕ 4,22 | 4,56 | ✕ 4,43 |
| cage-line (línea 3) | 4,05 | 3,78 | 3,30 | 3,39 | 3,66 | 3,55 |
| info (icono 3) | 4,14 | 3,86 | 3,38 | 3,46 | 3,74 | 3,63 |
| border (decorativo) | 1,51 | 1,41 | 1,23 | 1,26 | 1,36 | 1,33 |

`border` no porta información: solo divide, y las líneas de celda repiten lo que ya dicen las líneas de caja, la retícula y el contenido.

| Texto sobre relleno | Uso | Contraste |
|---|---|---|
| paper sobre accent | Botón principal | 5,92 |
| paper sobre ink | Aviso flotante | 14,51 |
| paper sobre danger | Acción destructiva | 5,55 |
| paper sobre jugador | Monogramas e iniciales | 5,28–6,34 |

### 2.6 Tiempos

| Token | Valor | Uso |
|---|---|---|
| `--t-error-flash` | 1500 ms | Destello del error en la celda (T-04.3; el cliente usa el mismo valor) |
| `--t-fast` | 120 ms | Transiciones cortas |

Además, en el CSS: sacudida del dígito erróneo de 320 ms (`sk-shake`) y puntos de espera con un ciclo de 1,2 s (`sk-wait`). Los avisos breves duran 6 s (decisión 4 de `design/entrega-f8.md`).

## 3. Tipografía

Dos familias con licencia SIL Open Font License 1.1, servidas en local como woff2 (`design/prototipo/fonts/`, con sus licencias):
- **Newsreader** (`--font-display`): solo en titulares editoriales de 24 px o más.
- **Inter** (`--font-ui`): toda la interfaz, los datos y el tablero, **siempre con cifras tabulares** (`font-variant-numeric: tabular-nums`) en números.

| Token | Familia | Tamaño / línea | Peso | Uso |
|---|---|---|---|---|
| display-l | Newsreader | 40 / 44 | 400 | Inicio y Resultados (32 / 38 en móvil) |
| display-m | Newsreader | 32 / 38 | 400 | Ayuda, Entrar o crear (26 / 32 en móvil) |
| display-s | Newsreader | 24 / 30 | 500 | Encabezados de sección editoriales |
| title | Inter | 18 / 24 | 600 | Paneles y diálogos |
| body | Inter | 15 / 22 | 400 | Texto corrido, Ayuda |
| label | Inter | 14 / 20 | 500 | Botones, controles, apodos |
| small | Inter | 13 / 18 | 400 | Registro de actividad, avisos |
| caption | Inter | 12 / 16 | 500 | Etiquetas. Mínimo de la interfaz |
| data-l | Inter | 18 / 24 | 600 tnum | Cronómetro y código |
| data | Inter | 14 / 20 | 500 tnum | Puntos, contadores |

Tablero:

| Elemento | 1280 | 360 | Peso |
|---|---|---|---|
| Número inicial | 37 | 19 | 600 |
| Resuelto y pista | 37 | 19 | 400 |
| Suma de jaula | 12 | 10 | 600 |
| Notas | 14 | 8 | 400 personal · 600 grupal |
| Notas en la lupa | — | 17 | 400 · 600 |
| Tecla del teclado | 22 | 20 | 500 |
| Contador de la tecla | 12 | 12 | 500 |

Los tamaños del tablero salen de la celda: dígito = 52 % de la celda, suma = 17 % (mínimo 10 px), notas según la altura de su fila (mínimo 8 px).

**Prueba del 1 y el 7.** En Inter, el 1 tiene un remate corto inclinado y fuste vertical; el 7, barra horizontal de ancho completo y fuste diagonal: se distinguen por dos rasgos y se mantiene a 10 px. Decisión tras la prueba en celular: Inter. **IBM Plex Sans** (también OFL, con el 1 con base) queda como **reserva** y no se usa en la interfaz; en el prototipo solo aparece en la hoja de tipografía.

## 4. Geometría

- **Espaciado** en escala de 4 px: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-12` 48 · `--s-16` 64.
- **Radios:** 6 px (`--r-sm`) en controles y celdas de la lupa; 10 px (`--r-md`) en paneles y diálogos.
- **Bordes:** 1 px en toda la interfaz; 2 px solo en las cajas del tablero, la selección propia y el foco.
- **Sombra flotante** (`--shadow-float`): solo diálogos y avisos.
- **Foco:** contorno ink de 2 px con 2 px de separación. Es ink para no confundirse con la selección, que es accent.
- **Área táctil mínima:** 44 × 44 px (`--target`). Excepción conocida: la celda del tablero a 360 px mide 37,3 px (el botón cubre la celda entera, bordes incluidos); la lupa ayuda a verificar la celda elegida. Verificada en un celular en el punto de control de F8, sin cambios.
- **Iconos:** SVG en línea, de trazo, 16 × 16 con trazo de 1,5 px y extremos redondeados, en `currentColor`. Dibujados para el prototipo; sin emojis ni biblioteca de iconos.

## 5. Componentes y sus estados

Las clases citadas están en `ui.css`, `screens.css`, `board.css` y `game.css`.

### 5.1 Botones (`.btn`)
- **Base:** paper, borde border de 1 px, radio 6, alto mínimo 44, texto label.
- **Variantes:** `primary` (accent, texto paper), `secondary` (paper, borde ink), `danger` (danger, texto paper), `ghost` (sin borde ni fondo), `lg` (alto 48, 15 px), `block` (ancho completo), `stack` (icono sobre la etiqueta, alto 52; herramientas en 1280).
- **Inactivo:** `aria-disabled="true"`, texto muted, fondo transparente y **borde discontinuo** muted. Sigue siendo enfocable y anuncia el motivo en su `aria-label` (por ejemplo, «Pista no disponible para espectadores»).
- **Enlace con forma de botón** (`a.btn`) y **enlace textual** (`.linkbtn`, subrayado con 3 px de separación).

### 5.2 Control segmentado (`.seg`)
Fondo surface; la opción activa es paper con borde ink y peso 600 (`aria-pressed="true"`). La opción no disponible lleva borde discontinuo (`aria-disabled`). Se usa para Número / Notas y Personal / Grupal (y en los controles de prueba).

### 5.3 Teclado numérico (`.key`)
Tecla surface con el dígito (22 px en 1280 y 768, 20 px en móvil) y, arriba a la derecha, **cuántos quedan** de ese dígito. Completa: fondo paper con contorno border, dígito muted y «✓» en lugar del contador (`.done`). Inactiva: igual que completa y sin contador (`aria-disabled`). El `aria-label` dice «Número 3, quedan 6» o «Nota 3, …» según el modo, y «no disponible ahora» si está inactiva.

Disposición: 3 × 3 en 1280; 9 en fila en 768; 5 + 4 escalonadas en 360 y en horizontal.

### 5.4 Capas de notas
- **Modo:** segmentado Número / Notas (atajo N). El espectador solo tiene Notas.
- **Capa de escritura:** Personal / Grupal (atajo G), activa solo en modo Notas.
- **Visibilidad:** un botón de ojo por capa (`.vis`). Oculta: ojo tachado, borde discontinuo y `aria-pressed="false"`. En escritorio se ve la forma corta («Personales», «Grupales») bajo «Mostrar notas»; el nombre accesible es el completo («Notas personales»). Desde 320 px y por debajo de 360, la capa y su ojo van en dos filas.
- **«Usar notas» (F8, preferencia local):** un interruptor de Ajustes, activado por defecto, que se guarda solo en el navegador (`localStorage`, `sk:pref:useNotes`) y no viaja por el protocolo (SPEC, R-06). Desactivado, se ocultan el selector Número / Notas, la capa de escritura, la visibilidad, la lupa y «Borrar»; el tablero no dibuja notas, N, G y Supr no hacen nada, y las teclas 1–9 solo colocan números. «Usar notas» va primero en Ajustes y recibe el foco inicial.

### 5.5 Jugadores
- **Monograma** (`.mono`, 32 px; 24 y 20 px en tamaños menores): círculo con el color del jugador y la inicial en paper. **Desconectado:** fondo paper, inicial y **contorno discontinuo** de su color. **Asiento libre:** círculo discontinuo border y «Asiento libre» / «N asientos libres».
- **Etiqueta** (`.tag`): «Desconectado», «Espectador», «Salió», «Empate»; con borde ink (`.tag.strong`) para «Inicia la partida» y «Empate».
- **Vidas:** tres corazones; llenos en ink, vacíos con trazo muted. Texto oculto «2 vidas de 3».
- **Puntos:** cifras tabulares; texto oculto « puntos».
- En 1280, lista vertical con nombre, etiqueta, puntos y vidas. En el resto, **franja horizontal desplazable** (`.strip`) con `role="group"` y «Desliza para ver todos».

### 5.6 Avisos
| Componente | Aspecto | Uso |
|---|---|---|
| Banner (`.banner`) | Franja surface bajo la cabecera con borde inferior ink; error: danger-tint y borde danger | Situación que persiste (reconectando, servidor, fin de partida) |
| Aviso breve (`.toast`) | Panel paper con borde ink, radio 10 y sombra; error: danger-tint y borde danger | Mensaje que no bloquea; 6 s |
| Aviso integrado (`.notice`) | Panel paper con borde ink, icono info | Información fija en la pantalla (espectador, sala borrada, traspaso) |
| Nota de campo (`.fnote`) y error de campo (`.ferr`) | Texto 13 px con icono info o danger | Formulario de Entrar |

Ubicación del aviso breve: en la línea de estado (360 y 768), bajo los jugadores (1280) o superpuesto a la derecha del tablero (horizontal). El texto de cada aviso queda también en el registro de actividad, con un icono de información: la decisión 4 (avisos de 6 s) depende de eso.

### 5.7 Diálogos (`.scrim` + `.dialog`)
Fondo ink al 45 %; panel paper de hasta 440 px, radio 10, sombra flotante. Título 18/600, cuerpo 15/22, acciones a la derecha (en móvil, apiladas a todo el ancho con la principal arriba). `role="dialog"` o `alertdialog`, `aria-modal`, foco atrapado, Esc cancela cuando hay cancelar, foco inicial en la acción segura («Cancelar», «Quedarme»). Sin botón de cancelar, el diálogo es bloqueante.

### 5.8 Formularios
- **Campo** (`.input`): alto 48, borde cage-line de 1 px, radio 6, 16 px. **Inválido:** borde danger de 2 px y `aria-invalid`. **Inactivo:** fondo surface y texto muted.
- **Código de sala** (`.input.code`): 20 px, peso 600, espaciado 0,24 em, mayúsculas, cifras tabulares.
- **Opciones de radio** (`.radio`): lista con divisores, alto 52; marcada con anillo accent de 6 px y el nombre en 600.
- **Interruptor** (`.switch`, `role="switch"`): pista de 44 × 26, encendido en accent, con el texto «Sí» / «No» debajo.

### 5.9 Otros
- **Espera** (`.waiting`): bloque surface con tres puntos animados y el texto «Esperando a que …».
- **Puntos en botón** (`.bdots`): para «Entrando…» y cargas.
- **Esqueleto** (`.skel`) para la carga inicial.
- **Registro de actividad (más sobrio desde F8):** monograma de 20 px, texto «Tomás · error en F7 C3» y tiempo de partida en tnum. En 1280, una sola línea con la última entrada bajo los jugadores y «Ver actividad», que abre el historial completo en un diálogo. En 360 y 768 queda plegado en un botón que muestra la última entrada (`aria-expanded`); en horizontal, detrás de un botón de cabecera. Una región oculta con `role="log"` anuncia cada entrada nueva, y el historial incluye los textos de los avisos.
- **Enlace al repositorio (F8):** solo en la cabecera del Inicio, arriba a la derecha; nunca en la partida. Es la marca de GitHub (Invertocat) en SVG local, sin CDN, de 20 px dentro de un área táctil de 44 × 44, en ink (el negro de la paleta), sin cambiar su forma ni su proporción, como piden las pautas de uso del logo de GitHub. Es un botón fantasma con el nombre accesible «Código fuente en GitHub» (también como `title`), abre https://github.com/slesgmd/sudoku-killer en otra pestaña (`target="_blank"`) con `rel="noopener noreferrer"`.
- **Menú compacto** (`.menu`): Ayuda, Ajustes y Salir en móvil y horizontal.
- **Marcador de foto** (`.ph`): rectángulo surface con aspa y leyenda de la foto prevista (ver `design/fotos.md`).
- **Controles de prueba** (`.testbar`, barra oscura): solo del prototipo, **no forman parte de la interfaz**.

## 6. Tablero y celdas

### 6.1 Dibujo
- Celda paper; líneas de celda de 1 px (border) y de caja de 2 px (ink).
- **Jaula:** línea discontinua de 2 px (`--cage-width`) a 3 px hacia dentro, con esquinas cóncavas resueltas; 3 px (`--cage-width-selected`) en la jaula de la celda seleccionada. Tiene el mismo grosor que la línea de caja, pero se distingue de ella por el trazo discontinuo, el color (`--cage-line` frente a ink) y la separación de 3 px.
  - **Grosores enteros:** Chromium redondea hacia abajo el ancho de un borde fraccionario a píxeles enteros en cualquier densidad (medido en F8: 1,5 px se dibuja como 1 px y 2,5 px como 2 px). WebKit lo hace solo con densidad 1. Por eso los dos grosores son enteros: con 2,5 px, la jaula seleccionada habría quedado igual que las demás en Chrome. El contraste de `--cage-line` no cambia: 4,05 sobre paper, 3,39 sobre selección, 3,66 sobre relación y 3,55 sobre error (mínimo 3:1).
- **Suma:** arriba a la izquierda de la celda ancla (la de menor índice), con el fondo de la celda para cortar la línea.
- **Variante A (elegida): franja superior reservada.** Todas las celdas reservan arriba la altura de la suma. Las notas ocupan el resto en una cuadrícula 3 × 3 con **posición fija por dígito** en todo el tablero.
- **Notas:** grupales en ink 600; personales en accent 400 subrayadas; en las dos capas, ink 600 subrayado en accent.
- **Lupa** (móvil y horizontal): la celda seleccionada ampliada a 88 px (94 en horizontal), con «Lupa · F2 C7» debajo en 360.

### 6.2 Estados
| Estado | Aspecto |
|---|---|
| Vacía | Paper, con suma si es la celda ancla |
| Número inicial | Dígito ink 600 |
| Resuelto | Dígito ink 400 |
| Pista | Dígito ink 400 y **esquina doblada** abajo a la derecha (info) |
| Pendiente | Dígito muted y **tres puntos** de espera; no admite otra jugada |
| Error | danger-tint, dígito danger **tachado** con la **inicial del autor** a su lado, sacudida breve; 1500 ms y lo ven todos |
| Selección propia | selection-tint y borde accent de 2 px |
| Relacionada | related-tint (fila, columna, caja y jaula) |
| Jaula seleccionada | Línea de jaula de 3 px |
| Presencia | Contorno de 1,5 px del color del compañero e inicial arriba a la derecha; «+N» si hay varios; 2 px más adentro si coincide con tu selección |
| Mismo dígito | **Anillo ink** de 1,5 px alrededor de los dígitos bloqueados iguales al de la celda seleccionada; sin color ni fondo; siempre activo |

### 6.3 Prioridad cuando se combinan estados

| # | Capa | Regla |
|---|---|---|
| 1 | Foco de teclado | Contorno ink de 2 px por fuera de la celda. Se ve sobre cualquier estado. |
| 2 | Selección propia | Borde accent de 2 px. Nada la tapa: la presencia ajena se dibuja 2 px más adentro. |
| 3 | Error en destello | 1500 ms. Fondo danger-tint por encima de selección y relación. Oculta las notas. Dígito tachado con la inicial del autor a su lado, sin taparlo. Lo ven todos. |
| 4 | Pendiente | Dígito muted y tres puntos de espera. Oculta notas. No acepta entradas hasta el veredicto. |
| 5 | Dígito bloqueado | Inicial 600, resuelto 400, pista 400 con esquina doblada. Oculta notas. |
| 6 | Mismo dígito | Anillo ink de 1,5 px alrededor de los dígitos bloqueados iguales al de la celda seleccionada. Sin color ni fondo; compatible con relación y presencia. |
| 7 | Presencia | Contorno de 1,5 px y la inicial arriba a la derecha; «+N» si hay varios. Ocupa la franja libre de la variante A. Nunca tapa un dígito: el dígito se centra bajo la suma. |
| 8 | Suma de jaula | Siempre visible, con el fondo de la celda para cortar la línea. |
| 9 | Notas | Debajo de todo lo anterior. La capa oculta no se dibuja. |
| 10 | Línea de jaula | 3 px en la jaula seleccionada, 2 px en el resto. |
| 11 | Fondo | danger-tint, luego selection-tint, luego related-tint, luego paper. |

## 7. Accesibilidad

- **Contraste AA** medido para cada par usado (sección 2.5); los pares que fallan están prohibidos.
- **Nunca solo color:** error (tachado, inicial y aviso con texto), notas (negrita frente a subrayado), pista (esquina doblada), pendiente (puntos), presencia (contorno e inicial), desconectado (contorno discontinuo y etiqueta), inactivo (borde discontinuo), capa oculta (ojo tachado), mismo dígito (anillo).
- **Teclado:** flechas para mover la selección; 1–9 para número o nota según el modo; N alterna Número y Notas; G alterna la capa; Supr borra las notas de la capa activa en la celda; Ctrl+Z deshace tus últimas notas (agrupadas); H pide pista (abre la confirmación); Esc cierra un diálogo o un menú. Implementados en F8; se ignoran mientras el foco está en un campo de texto. Se listan en la Ayuda (F10).
- **Foco itinerante en el tablero:** solo la celda seleccionada entra en el orden de tabulación (`tabindex` 0; el resto −1). El tablero es `role="grid"` con filas y `gridcell` y `aria-selected`.
- **Etiqueta de cada celda:** «Fila 2, columna 7, jaula de 10, vacía, notas grupales 1 y 2, notas personales 2 y 4», «…, 3, resuelta por Rafa», «…, pista usada por Valeria», «…, pendiente de confirmación», «…, vacía; Tomás acaba de fallar con un 3», más «mismo número que la celda seleccionada» y «Valeria está aquí».
- **Regiones vivas:** avisos con `role="status"` (polite) o `role="alert"` (assertive) según la tabla de estados; región oculta `aria-live` con la última actividad; `aria-busy` durante las cargas; cronómetro `role="timer"` con `aria-live="off"`.
- **Diálogos:** foco atrapado, Esc, foco inicial en la acción segura y vuelta al control que lo abrió (confirmado en F8, con prueba de componente).
- **Foco inicial de Ajustes (resuelto en F8):** en el primer interruptor («Usar notas»), en el lobby y en la partida, porque los interruptores son los controles del diálogo y la razón de abrirlo. Activarlo exige Espacio o Intro, así que no hay cambios por accidente. «Cerrar» y la X cierran, igual que Esc.
- **Movimiento reducido:** con `prefers-reduced-motion`, sin sacudida del error ni animación de los puntos.
- **Texto oculto** donde la forma no basta: puntos, vidas, «Puesto 2, empate», código deletreado («H P Q 6 N Z»).
- **Áreas táctiles** de 44 px, salvo la celda del tablero a 360 px (37,3 px; sección 4).
- **Avisos breves de 6 s:** se aceptan frente a WCAG 2.2.1 (decisión 4 de `design/entrega-f8.md`).

## 8. Responsive

Partida (convención del prototipo en `game.css`; en producción, media queries):

| Disposición | Ventana | Distribución |
|---|---|---|
| Escritorio | ≥ 1024 px (artboard de 1280) | Tres columnas: jugadores (240) · tablero (640) · panel lateral (272) con modo, capas, teclado 3 × 3, herramientas y actividad |
| Tableta | 600–1023 px (768) | Una columna: tablero de 600, franja de jugadores, línea de estado, controles en fila y teclado de 9 |
| Móvil vertical | < 600 px (360) | Una columna: tablero de 336, franja de jugadores, línea de estado, lupa + controles, herramientas y teclado de 10 columnas escalonado |
| Móvil horizontal | alto < 480 px (740 × 360) | Tablero de 336 a la izquierda; cabecera, franja, controles y teclado a la derecha; banners y avisos superpuestos sobre la columna derecha |

En móvil y horizontal, la cabecera es compacta (código, dificultad, cronómetro, pistas y menú «⋯»).

Resto de pantallas (`screens.css`): `.L-movil` (< 600 px) y `.L-escritorio` (≥ 1024 px). **Pendiente para F10:** el prototipo no dibuja estas pantallas entre 600 y 1023 px.

## 9. Estados transversales

Cuatro tipos:
- **Banner:** franja bajo la cabecera; persiste mientras dura la situación.
- **Aviso:** mensaje breve que no bloquea; se cierra a los 6 s y lo importante queda en el registro.
- **Diálogo:** modal; bloqueante si no tiene cancelar.
- **Integrado:** cambia la propia pantalla (controles inactivos, esqueletos, avisos fijos).

| Estado | Tipo | Texto | Comportamiento |
|---|---|---|---|
| Carga inicial | Integrado | «Cargando la partida…» | Tablero sin jaulas ni dígitos, jugadores en esqueleto, controles inactivos, cronómetro «––:––». `aria-busy`; el texto se anuncia como estado. |
| Reconectando | Banner + integrado | «Reconectando… Tus notas se guardan y se enviarán al volver (2 en cola). Los números se bloquean hasta entonces.» | Teclas de número y Pista inactivas; las notas siguen y se encolan. `role=status`. |
| Sesión en otra pestaña | Diálogo bloqueante | «La sala está abierta en otra pestaña» | `alertdialog` sin cierre; «Jugar en esta pestaña» reconecta y desplaza a la otra. |
| Versión incompatible | Diálogo bloqueante | «Hay una versión nueva del juego» | Una sola acción, «Recargar»; recuerda que el asiento se conserva 2 minutos. |
| Servidor no disponible | Banner de error + integrado | «El servidor no responde. Lo que hagas no se registrará hasta que vuelva. Reintentando…» | Bloquea todo lo que se envía. `role=alert` al aparecer. |
| Demasiadas acciones | Aviso | «Vas muy rápido: la última acción no se envió. Espera un momento y repítela.» | Polite. Sin efecto en vidas ni puntos. |
| Sala borrada | Aviso integrado | «La sala HPQ6NZ ya no existe. Las salas se borran tras 2 minutos sin nadie conectado.» | En Inicio, con ficha caducada: se descarta la ficha. En Entrar, error «sala inexistente». |
| Acción no permitida | Aviso de error | «No se usó la pista: ya eres espectador y solo puedes escribir notas.» | Assertive. La acción salió antes del cambio de rol; sin efecto. |
| Partida terminada | Banner + integrado | «La partida terminó. El equipo completó el tablero en 31:07.» con «Ver resultados» | Tablero completo sin selección ni lupa; controles inactivos; cronómetro detenido. En F8, sin la pantalla Resultados, el botón es «Volver al inicio» (decisión del usuario); «Ver resultados» llega con Resultados en F10. |
| Confirmación de salida | Diálogo | «¿Salir de la sala?» | `alertdialog`; foco en «Quedarme»; Esc cancela. Aviso de traspaso del derecho de iniciar solo si quien sale lo tiene (decisión 2), también en la partida (decidido en F8). |
| Confirmación de pista | Diálogo | «¿Usar una pista en F2 C7?» «Cuesta −H puntos a quien la usa y no da bonus.» | Siempre se pide; requiere celda vacía; foco en «Cancelar». |
| «Ya resuelta» | Aviso, solo al autor | «Valeria resolvió F1 C3 un instante antes. Tu jugada no cuenta y no pierdes vida.» | Polite; sin destello. |
| Error propio | Aviso de error + destello | «El 3 no va en F7 C3. Te quedan 2 vidas.» | Assertive; destello de 1500 ms con tu inicial, que ven todos. |
| Paso a espectador | Aviso de error + aviso fijo | «Te quedaste sin vidas. Ahora eres espectador: puedes seguir escribiendo notas.» | Aviso fijo «Eres espectador: solo puedes escribir notas»; Número y Pista inactivos. |
| Se recuperaron X de Y notas | Aviso | «Se recuperaron 3 de 5 notas. Las otras 2 cambiaron después de que las borraras.» | Tras deshacer un «Borrar notas» (decisión 5). Polite. |
| No se pudo deshacer | Aviso | «No se pudo deshacer: otra persona cambió esa nota grupal después.» | También «…: la celda ya está resuelta». Polite. |
| Traspaso del derecho de iniciar | Aviso integrado | «Inés salió de la sala. Ahora inicia la partida Tomás.» | En el lobby. `role=status`. |
| Errores al entrar | Error de campo o aviso | Sala inexistente, sala llena, apodo en uso, apodo no válido, fallo de conexión, carga | Hoja «Entrar · validación, errores y carga». |
| No se pudo empezar (F8) | Aviso de error en el formulario | «No se pudo empezar. La partida no terminó de cargar. Revisa tu conexión y vuelve a intentarlo.» con «Reintentar» | Si la entrada o la carga fallan (error del servidor) o no terminan en 15 s, el inicio vuelve con el aviso en lugar de «Entrando…» para siempre. Es el mismo aviso que «Fallo de conexión» en Entrar: `role=alert`, con el apodo y la dificultad conservados. «Reintentar» vuelve a enviar el formulario. Si ya había entrado a la sala, sale de ella. T-37.1. |

---

## Revisión de originalidad (T-18.1)

**Fecha:** 2026-10-23. **Alcance:** las 4 páginas y los 51 artboards de `design/prototipo/` y los tokens, la tipografía, los iconos y los textos de esta guía. **Contra qué se compara:** la app de referencia (sudoku.com/es/killer) tal como la describe `docs/referencia.md`. Ese estudio registró **solo comportamiento**, sin colores, tipografías, maquetación ni capturas, y el repositorio no guarda material visual de la referencia (la evidencia de F1 está fuera de git). Por eso la revisión comprueba que la identidad se definió desde cero y que lo que coincide con la referencia es una convención del género o una función, no su forma.

| Comprobación | Resultado |
|---|---|
| Paleta | Propia: gama tierra y piedra con acento verde oliva, definida y medida en `tokens.css` (sección 2). No se tomó ningún color de la referencia. |
| Tipografía | Newsreader + Inter (OFL), elegidas por la prueba del 1 y el 7; IBM Plex Sans de reserva. |
| Iconografía | SVG de trazo dibujados para el prototipo; sin iconos, logos ni recursos de la referencia. |
| Textos | Propios, en español, escritos para este juego (cooperativo, notas por capas, vidas por persona, pistas de equipo). |
| Código | El prototipo no contiene código de la referencia; su motor (`support.js`) es propio. |
| Tablero | Retícula 9 × 9 con cajas marcadas, jaulas discontinuas con la suma arriba a la izquierda: **convención del sudoku killer**, común a todo el género. La forma es propia: franja reservada para la suma (variante A), línea a 3 px con esquinas cóncavas y suma que corta la línea con el fondo de la celda. |
| Selección y resaltado | Resaltar fila, columna y caja es una convención del género. Lo propio: resaltado también de la **jaula** (línea de 2 px), que la referencia no tiene (`docs/referencia.md`, sección 7), y **anillo** para el mismo dígito en lugar de relleno. |
| Notas | La referencia solo tiene notas personales con un control de lápiz. Aquí hay **dos capas** (personal y grupal) con marca tipográfica distinta, selector de capa de escritura y de visibilidad, y una lupa en móvil. |
| Teclado | Un teclado numérico es una convención del género. Lo propio: **contador de restantes** en cada tecla y «✓» al completar (la referencia solo deshabilita la tecla, sección 13); disposición escalonada en móvil. |
| Errores y vidas | Vidas por persona con corazones, destello con la **inicial del autor**, paso a espectador: mecánicas y formas propias del modo cooperativo. |
| Funciones sin equivalente en la referencia | Salas con código y apodo, lobby, presencia de compañeros, registro de actividad, ranking de aporte, pistas compartidas con confirmación, estados de red. |
| Funciones de la referencia que no se replican | Pantalla de pausa, ajustes de resaltado desactivables, puntuación por velocidad. |

**Conclusión:** nada del prototipo replica la interfaz de la app de referencia. Las coincidencias son convenciones del sudoku killer (retícula, jaulas con suma, teclado numérico, resaltado de fila, columna y caja) resueltas con forma propia. Cumple R-18 y T-18.1.

**Para F8:** al implementar no se toman capturas ni recursos de la referencia; cualquier cambio de diseño que se acerque a ella se vuelve a revisar con esta lista.

**Repaso al cerrar F8 (2026-10-24).** Cambios de diseño del punto de control y de la prueba con el bot, revisados con la misma lista:
- **Jaulas de 2 px y de 3 px la seleccionada:** solo cambia el grosor de una forma propia (línea discontinua a 3 px hacia dentro, con esquinas cóncavas).
- **Actividad en una línea con «Ver actividad»:** el registro de actividad no tiene equivalente en la referencia.
- **«Usar notas»:** es una preferencia local que oculta las notas por capas, que la referencia no tiene. No se parece a sus ajustes de resaltado, que no se replican.
- **Dígito pendiente inmediato** y **aviso con «Reintentar» al no poder empezar:** son estados propios, dibujados con los componentes del prototipo.
- **Enlace al repositorio en el inicio:** es la marca de GitHub según sus pautas, no un recurso de la referencia.

Ningún cambio acerca la interfaz a la de la referencia. T-18.1 sigue cumplida.
