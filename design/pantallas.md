# Pantallas y flujos

Derivado del prototipo de `design/prototipo/` (se abre con `npx serve design/prototipo`). La guía de estilo está en `docs/diseno.md`. Las correcciones al prototipo se citan como «decisión N» y están en `docs/diseno.md`, sección 10. Donde el prototipo no dibuja algo, se indica cómo lo resuelve la aplicación.

Datos de ejemplo del prototipo: sala `HPQ6NZ`, dificultad Media sin números iniciales, jugadores Inés (tú), Tomás, Valeria, Rafa (desconectado) y Bruno (espectador).

Todas las pantallas fuera de la partida comparten la **cabecera** (`.apphead`): «Sudoku Killer» a la izquierda; «Ayuda» y «Ajustes» a la derecha (64 px de alto en escritorio y 52 en móvil). Ajustes solo debe aparecer dentro de una sala (decisión 1).

---

## 1. Pantallas

### 1.1 Inicio
**Artboards:** Inicio · 1280 · sin ficha; Inicio · 1280 · «Volver a la sala»; Inicio · 360; Inicio · 360 · «Volver a la sala»; Inicio · 360 · la sala ya no existe.

**Objetivo:** explicar el juego en una frase y llevar a entrar o crear una sala, o a volver a la sala de la ficha guardada.

**Distribución:**
- Escritorio: dos columnas; a la izquierda, el titular «Un tablero, varias cabezas.» (display-l), la bajada, las acciones y tres datos («Jugadores: Hasta 6», «Vidas: 3 cada uno», «Pistas: 3 por equipo»); a la derecha, la foto de 520 × 600.
- Móvil: una columna con la foto de 336 × 200 arriba y el texto debajo.

**Acciones:** «Entrar o crear sala» (principal), «Cómo se juega» (enlace a Ayuda), Ayuda y Ajustes en la cabecera.

**Estados:**
- **Sin ficha:** solo «Entrar o crear sala».
- **Con ficha válida:** «Volver a la sala HPQ6NZ» (principal) con la nota «Recuperas tus vidas, puntos y notas si queda un asiento libre», y «Entrar o crear otra sala» (secundario). El destino depende del estado de la sala (decisión 3).
- **Sala borrada:** aviso integrado «La sala HPQ6NZ ya no existe. Las salas se borran tras 2 minutos sin nadie conectado.»; la ficha se descarta y queda «Entrar o crear sala».

### 1.2 Entrar o crear sala
**Artboards:** Entrar · 1280; Entrar · 1280 · sala llena; Entrar · 360 · carácter rechazado; Entrar · 360 · cargando; Entrar · validación, errores y carga (hoja con 8 estados a 360).

**Objetivo:** elegir un apodo y entrar con un código o crear una sala nueva.

**Distribución:**
- Escritorio: foto de 560 × 640 a la izquierda y el formulario (hasta 440) a la derecha.
- Móvil: foto de 336 × 168 arriba y el formulario debajo.
- Encima del titular, el enlace «Inicio» para volver.

**Contenido:** titular «Entrar o crear una sala» y bajada; campo «Tu apodo» (2 a 16 caracteres, único en la sala); grupo «Entrar con código» con el campo «Código de la sala» (6 caracteres, mayúsculas automáticas, sin 0, O, 1, I ni L) y el botón «Entrar»; separador «o»; «Crear sala nueva» con la nota «Recibirás un código para invitar a hasta 5 personas más».

**Estados** (en la hoja de estados, con su anuncio):
| Estado | Presentación |
|---|---|
| Listo para enviar | Integrado: apodo válido y código completo |
| Apodo no válido | Error de campo, se comprueba antes de enviar; foco al campo, alerta |
| Carácter rechazado | Nota en línea: «La «O» no se usa en los códigos y no se añadió.» El carácter no se escribe |
| Sala inexistente | Error de campo devuelto por el servidor (`room.not_found`) |
| Sala llena | Aviso de error en el formulario, asertivo (`room.full`); los datos se conservan |
| Apodo en uso | Error de campo (`nickname.taken`); incluye apodos reservados durante la partida |
| Fallo de conexión | Aviso en el formulario con «Reintentar»; nada se pierde |
| Cargando | Campos y botones inactivos, «Entrando…» con puntos, `aria-busy` |

### 1.3 Lobby (sala de espera)
**Artboards:** Lobby · 1280 · quien inicia; Lobby · 1280 · los demás, sala llena, traspaso; Lobby · 360 · quien inicia; Lobby · 360 · los demás; Ajustes · 1280 · sobre el lobby.

**Objetivo:** compartir el código, ver quién está y, quien tiene el derecho, elegir la dificultad e iniciar.

**Distribución:**
- Escritorio: titular «Sala de espera» con «Salir de la sala» a la derecha. Dos columnas: a la izquierda, el código y la lista de jugadores; a la derecha (400), la dificultad y la acción.
- Móvil: una columna; la acción principal queda **fija al pie** mientras se desplaza la página.

**Contenido:**
- **Código:** «HPQ6NZ» en grande (40 px; 32 en móvil), «Copiar código» (pasa a «Código copiado» con una marca y se anuncia) y «Compartir». Nota: «Quien tenga el código puede entrar mientras queden asientos, también con la partida en curso.»
- **Jugadores** con «N de 6»: monograma, nombre, « · tú», etiqueta «Inicia la partida» y «Desconectado»; asientos libres con círculo discontinuo. Con la sala llena: «Sala llena: nadie más puede entrar hasta que se libere un asiento.»
- **Dificultad:** quien inicia ve opciones de radio, cada una con sus números iniciales según la equivalencia versión 2 (Fácil, «30 números iniciales»; Media, «22 números iniciales»; Difícil, «10 números iniciales»; Experto, «Sin números iniciales»; corrección tras la primera prueba en tiempo real) y «Solo tú puedes cambiarla. Los demás la ven al momento.» Los demás ven la dificultad elegida y «La elige Tomás, que inicia la partida.»

**Acciones:** quien inicia: «Iniciar partida» (principal) con la nota «Puedes iniciar aunque estés solo. Quien entre después se suma a la partida en curso con 3 vidas.» Los demás: bloque de espera «Esperando a que Tomás inicie la partida.» Todos: «Salir de la sala».

**Estados:** quien inicia o los demás; con sitio o llena; traspaso («Inés salió de la sala. Ahora inicias tú la partida.» o «… Ahora inicia la partida Tomás.»); diálogo de salida («Tu asiento queda libre al momento.» y, solo si quien sale tiene el derecho de iniciar, «El derecho de iniciar pasará a Tomás y no vuelve a ti aunque regreses.», decisión 2); Ajustes abierto.

### 1.4 Partida
**Artboards:** Partida · 1280; Partida · 768; Partida · 360; Partida · móvil horizontal 740 × 360; Componente Partida (las cuatro disposiciones); Tablero; y los 19 artboards de estados (sección 1.8).

**Objetivo:** jugar en equipo: colocar números, tomar notas, ver a los compañeros y seguir la actividad.

**Distribución:** la de `docs/diseno.md`, sección 8 (tres columnas en 1280; una columna en 768 y 360; tablero a la izquierda en horizontal).
- **Cabecera:** en 1280 y 768, «Sudoku Killer» (solo 1280), sala, dificultad, cronómetro y «Pistas 2/3», con Ayuda, Ajustes y «Salir». En 360 y horizontal, cabecera compacta: código, dificultad, cronómetro, pistas y menú «⋯» (Ayuda, Ajustes, Salir de la sala); en horizontal, además, un botón de actividad.
- **Tablero** de 640, 600 o 336 px.
- **Jugadores:** lista en 1280 (nombre, etiqueta, puntos, vidas y asientos libres); franja desplazable en el resto.
- **Actividad:** lista de las últimas jugadas en 1280; en 768 y 360, un botón plegable con la última entrada; en horizontal, detrás del botón de la cabecera.
- **Controles:** modo Número / Notas; capa Personal / Grupal; visibilidad de cada capa; Borrar (solo en modo Notas), Deshacer y «Pista · 2»; teclado con contadores. En 360 y horizontal, la lupa a la izquierda de los controles.

**Acciones:** seleccionar celda (clic o flechas), escribir número o nota, cambiar modo y capa, mostrar u ocultar capas, borrar notas, deshacer, pedir pista, abrir Ayuda o Ajustes, salir.

**Estados:** activo o espectador; los 17 estados del selector del prototipo (ninguno, carga, reconectando, otra pestaña, versión, servidor, demasiadas, no permitida, terminada, salir, pista, ya resuelta, error propio, espectador, recuperadas, no se pudo deshacer, ajustes). Detalle en `docs/diseno.md`, sección 9.

### 1.5 Resultados
**Artboards:** Resultados · 1280 · victoria, quien inicia; Resultados · 1280 · derrota, los demás; Resultados · 360 · victoria; Resultados · 360 · derrota.

**Objetivo:** cerrar la partida con el resultado del equipo y el ranking de aporte, y volver al lobby.

**Distribución:** foto de fondo a pantalla completa; encima, un panel paper de hasta 720 px (48 px de margen en escritorio; a todo el ancho en móvil).

**Contenido:** «Partida terminada · Media»; titular «Tablero resuelto.» o, en una derrota, el de su causa (SPEC 1.8, corrección tras la primera prueba en tiempo real): «Se acabaron las vidas.», «La partida quedó sin jugadores.» o «La partida quedó sin jugadores activos.»; bajada («El equipo completó las 81 celdas.» o la de la causa: «Todos los jugadores perdieron sus 3 vidas antes de completar el tablero.», «Todos los jugadores salieron o estuvieron desconectados más de 2 minutos.» o «Los jugadores que quedaban perdieron sus vidas o salieron de la partida.»); datos «Tiempo total» y «Pistas usadas por el equipo»; tabla «Ranking de la partida» (Puesto, Jugador, Puntos, Errores) con «· tú», etiquetas «Empate» y «Salió», y la nota del desempate.

**Acciones:** quien inicia: «Volver al lobby» (principal). Los demás: «Esperando a que Inés vuelva al lobby.» Todos: «Salir de la sala», con un diálogo («Dejarás tu asiento libre y no estarás en la próxima partida.» y el aviso de traspaso solo para quien tiene el derecho, decisión 2).

### 1.6 Ayuda
**Artboards:** Ayuda · 1280; Ayuda · 360.

**Objetivo:** explicar las reglas y la mecánica cooperativa.

**Distribución:**
- Escritorio: índice fijo «En esta página» de 220 px a la izquierda y el artículo a la derecha.
- Móvil: el índice es un desplegable bajo el titular.
- Enlace «Volver» (vuelve a la pantalla anterior) y titular «Cómo se juega».

**Secciones:** Reglas del killer; Juego cooperativo; Vidas y espectadores; Capas de notas (con tres celdas de muestra: grupales, personales y ambas); Pistas; Jugadas simultáneas; Desconexión; Atajos de teclado (tabla).

### 1.7 Ajustes (diálogo)
**Artboards:** Diálogo de ajustes; Ajustes · 1280 · sobre el lobby; Ajustes · 360 · sobre la partida.

**Objetivo:** las preferencias personales, que se aplican al momento y solo a quien las cambia.

**Contenido:** un interruptor, «Limpiar notas personales automáticamente» (activado por defecto), con la explicación «Cuando alguien acierta un número, ese número se quita de tus notas personales en su fila, columna, caja y jaula. Las notas grupales se limpian siempre.»; la nota «El movimiento reducido sigue la preferencia de tu sistema.»; «Cerrar» y la X. Esc cierra.

**Disponibilidad:** solo dentro de una sala (lobby, partida y resultados), porque `settings.update` exige ser miembro (decisión 1). El prototipo también lo ofrece en Inicio, Entrar y Ayuda: la aplicación lo quita de ahí (en Ayuda, solo si se abrió fuera de una sala).

### 1.8 Estados transversales
**Artboards:** Estados · tipo, texto y comportamiento (tabla resumen); a 360: carga inicial, reconectando, versión incompatible, demasiadas acciones, acción no permitida, ya resuelta, error propio, paso a espectador, confirmación de salida, confirmación de pista; a 1280: sesión en otra pestaña, servidor no disponible, partida terminada, confirmación de salida, confirmación de pista, se recuperaron X de Y notas; a 768: no se pudo deshacer; en horizontal: reconectando.

Tipos, textos y comportamiento en `docs/diseno.md`, sección 9.

---

## 2. Flujos

### 2.1 Crear
Inicio → «Entrar o crear sala» → Entrar: apodo → «Crear sala nueva» → «Entrando…» → Lobby como quien inicia (asiento 0, con «Inicia la partida»).
- Apodo no válido: error en el campo, sin enviar.
- Fallo de conexión: aviso con «Reintentar».
- **En la aplicación:** al entrar se pasa al lobby. El prototipo se queda en «Entrando…», y la transición se ve con el enlace «Ir al lobby» de los controles de prueba.

### 2.2 Unirse
Entrar: apodo + código → «Entrar» → Lobby (los demás) si la sala espera.
- Errores: sala inexistente, sala llena, apodo en uso, carácter rechazado (en línea, sin enviar), fallo de conexión.
- Con la partida en curso y un asiento libre, se entra en la partida con 3 vidas (lo dicen el lobby y la Ayuda). El prototipo no dibuja esa llegada directa; la aplicación la anuncia con un aviso.

### 2.3 Volver con ficha
Inicio con ficha → «Volver a la sala HPQ6NZ» → la pantalla del estado de la sala: lobby, partida o resultados (decisión 3), con vidas, puntos y notas si queda asiento.
- Sala borrada: aviso integrado en Inicio y la ficha se descarta.
- **En la aplicación:** volver con ficha a una sala sin asientos libres muestra un aviso en Inicio (el prototipo no lo dibuja).

### 2.4 Iniciar
Lobby, quien inicia: elige la dificultad (los demás la ven al momento) → «Iniciar partida» → Partida (carga inicial y luego el tablero). Los demás: bloque de espera; pasan a la partida cuando empieza (`match.started`; el prototipo no dibuja la transición).
- Traspaso: si quien inicia sale, aviso integrado a los demás y el derecho pasa a otra persona.

### 2.5 Jugar
Seleccionar una celda (clic, toque o flechas; en móvil, la lupa la muestra ampliada) → modo Número → tecla 1–9 → la celda queda **pendiente** (dígito muted con puntos) → veredicto del servidor:
- **Acierto:** la celda se bloquea (resuelta por quien la puso), entra en el registro y el contador de la tecla baja; con 0 restantes, la tecla muestra «✓».
- **Ya resuelta:** aviso solo al autor; no cuenta y no quita vida.
- **Error:** sección 2.8.

### 2.6 Notas
Modo Notas (N) → capa Personal o Grupal (G) → teclas 1–9 alternan la nota en la celda; se aplican al momento.
- Visibilidad de cada capa con el ojo.
- «Borrar» (Supr) quita las notas de la capa activa en la celda.
- «Deshacer» (Ctrl+Z) revierte tus últimas notas; si otra persona cambió la nota grupal después, «No se pudo deshacer…». Deshacer un «Borrar notas» agrupa varios `note.undo` y resume «Se recuperaron X de Y notas» (decisión 5).
- Limpieza automática al acertar: siempre en las grupales; en las personales, según Ajustes.
- **Prototipo:** no tiene acciones en Borrar, Deshacer ni en las teclas; el flujo se ve en los estados.

### 2.7 Pista
Celda vacía seleccionada → «Pista · 2» (H) → diálogo «¿Usar una pista en F2 C7?» («Cuesta −H puntos a quien la usa y no da bonus.» y «Quedan 2 pistas para todo el equipo.») → «Usar pista» coloca el número correcto con la esquina doblada; «Cancelar» o Esc no hace nada.
- Inactiva para espectadores, sin pistas, con una celda ocupada («Pista: elige una celda vacía»), al reconectar o sin servidor.
- Si el rol cambió antes de llegar: «No se usó la pista: ya eres espectador…».
- H = 60 puntos (`docs/puntuacion.md`).

### 2.8 Error
Número incorrecto → destello de 1500 ms en la celda (fondo danger-tint, dígito tachado con tu inicial; lo ven todos) → la celda vuelve a quedar vacía. A quien falla: aviso asertivo «El 3 no va en F7 C3. Te quedan 2 vidas.»; pierde una vida y puntos. El registro anota «Inés · error en F7 C3».

### 2.9 Paso a espectador
Error con la última vida → aviso de error «Te quedaste sin vidas. Ahora eres espectador: puedes seguir escribiendo notas.» → aviso fijo «Eres espectador: solo puedes escribir notas» → Número y Pista inactivos; la etiqueta «Espectador» y los corazones vacíos en la lista. Conserva los puntos.

### 2.10 Desconexión y reconexión
- **Propia:** banner «Reconectando…»; los números y la pista se bloquean; las notas siguen y se encolan («2 en cola») y se envían al volver. Si el servidor no responde, banner de error y todo lo que se envía queda bloqueado.
- **De un compañero:** monograma con contorno discontinuo y la etiqueta «Desconectado»; tiene 2 minutos para volver con su asiento.
- **Otra pestaña:** diálogo bloqueante «La sala está abierta en otra pestaña» con «Jugar en esta pestaña».
- **Versión nueva:** diálogo bloqueante con «Recargar» (el asiento se conserva 2 minutos).
- **En la aplicación:** al volver se anuncia «Conexión recuperada» (el prototipo no dibuja el regreso).

### 2.11 Fin y vuelta al lobby
Última celda → banner «La partida terminó. El equipo completó el tablero en 31:07.» con «Ver resultados»; el tablero queda completo, sin selección y con los controles inactivos → Resultados (victoria o derrota). Quien expiró figura como «Salió».
- Quien inicia: «Volver al lobby» → Lobby con los mismos jugadores.
- Los demás: «Esperando a que Inés vuelva al lobby.»
- Todos: «Salir de la sala».
- **En la aplicación:** el paso a Resultados es solo con «Ver resultados», y cuando quien inicia vuelve al lobby, todos pasan al lobby con un aviso (el prototipo no lo dibuja).
