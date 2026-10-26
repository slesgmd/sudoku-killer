# Estudio de referencia: sudoku.com/es/killer (F1)

Fecha del estudio: 2026-10-22. Alcance: **solo comportamiento** del modo killer de https://sudoku.com/es/killer. No se describen colores, tipografías, maquetación ni se incluyen capturas. El texto está escrito con palabras propias; no se copia código de la app de referencia.

## Cómo leer este documento

Cada punto lleva una marca:

| Marca | Significado |
|---|---|
| **[Observado]** | Visto en ejecución con REA (página real, en un navegador controlado), con evidencia citada. |
| **[Visto en el código]** | Leído en el código JavaScript que la página entrega al navegador. Describe lo que el código hace, pero no se vio ejecutarse. |
| **[Inferido]** | Deducción razonable a partir de lo anterior; no está demostrado. |
| **[Observado manualmente por el autor]** | Observación hecha a mano por el autor, sin evidencia de REA. |

## Evidencia

Toda la evidencia de REA (versión 6.7.0) está en `evidence/f1-referencia.json` (carpeta ignorada por git; SHA-256 del archivo `4f4c0b02695de675db536ef39a976fd58bbd4ee21de6aa32ff44a77b21d085f8`). Se cita por su `evidence_id` abreviado.

| Cita | `evidence_id` | Operación | Qué contiene |
|---|---|---|---|
| **E1** | `ev_33a8a5362bf2527b9438169e37d15ae7d2dcf4e3a664d9574277b969c5c82f95` | `inspect_web_page` | Inspección pasiva de `/es/killer` ya cargada: scripts (con su código), recursos, claves de almacenamiento local. |
| **E2** | `ev_1a8351830fd3404683672dee00b1a73d57b14ea179db3dd6f77446b63782e91d` | `export_web_scripts` | Exportación de los scripts de E1, entre ellos el bundle principal `ref-game.8da14029.js` (SHA-256 `d1f26dd4d7382cf50e1cf1979ba5ef659a6adc1501ba8bb13498b5bc1b57aa8b`). Todo lo marcado **[Visto en el código]** sale de este bundle o de los scripts en línea de la página. |
| **E3** | `ev_f1c983e3be4c1382cb4c1480dd95563dfcffbf3066eac331d3db4ba98a3d3139` | `capture_browser_scenario` | Escenario A: carga en frío de `/es/killer` con red registrada. La navegación posterior a `/es/killer/experto/` superó el límite de 45 s y no se completó. |
| **E4** | `ev_5ca3960657340532e6cd4daa1e9a63be49bcb2956eeece08a1350bbaa2423269` | `capture_browser_scenario` | Escenario B: 29 pasos sobre el nivel fácil inicial (selección, aciertos, dígito completo, tres errores). DOM y almacenamiento capturados tras cada paso. |

Dos intentos posteriores de cargar la página (para ver un nivel servido por la API) fallaron al navegar y no generaron evidencia. Por decisión del autor no se hicieron más cargas automáticas; lo que faltaba quedó marcado como visto en el código o inferido, y se lista en [Preguntas abiertas](#preguntas-abiertas).

---

## 1. Origen de los puzzles

- **[Observado, E3]** En una carga en frío (perfil de navegador nuevo) de `/es/killer`, la partida empezó sin ninguna petición a la API de niveles de sudoku.com: solo se descargaron el HTML, los scripts, estilos e imágenes, y tráfico de analítica y publicidad. La analítica registró el inicio de partida.
- **[Observado, E3]** El HTML de la página no trae el puzzle.
- **[Visto en el código, E2]** La **primera partida de cada combinación modo + dificultad** usa un nivel fijo que viene dentro del bundle (hay uno por dificultad: 4 de killer y 6 del modo clásico). Al usarlo, el navegador anota en `localStorage.start_level` que esa combinación ya consumió su nivel inicial.
- **[Visto en el código, E2]** A partir de ahí, cada partida nueva pide el nivel al servidor con `GET /api/level/{dificultad}?mode=killer`. La petición envía el idioma y, si existe, la lista de los últimos niveles jugados en esa dificultad (hasta 250) para que no se repitan. Si falla, reintenta una vez.
- **[Visto en el código, E2]** Al terminar un nivel se envía al servidor `POST /api/level/finish` con el identificador del nivel y el índice de la dificultad (estadística; la petición se hace aunque la página se cierre).
- **[Inferido]** Los puzzles **no se generan en el navegador**: vienen precargados (el primero) o del servidor (los siguientes). No hay indicios de un generador en el cliente.

## 2. Formato de datos de un nivel

- **[Visto en el código, E2]** Un nivel es un objeto con estos campos:
  - `id`: número entero que identifica el nivel.
  - `mission`: texto de 81 dígitos con los números iniciales, fila por fila; `0` significa celda vacía.
  - `solution`: texto de 81 dígitos con la solución completa, en el mismo orden.
  - `cages`: lista de jaulas; cada jaula es una lista de índices de celda (0 a 80, índice = 9 × fila + columna).
  - `win_rate`: número (por ejemplo, 63,84); se muestra como dato orientativo de la dificultad.
- **[Visto en el código, E2]** **Las sumas de las jaulas no vienen en los datos**: el navegador las calcula sumando los valores de la solución en las celdas de cada jaula.
- **[Visto en el código, E2]** En los 4 niveles killer incluidos en el bundle: 34 jaulas por nivel, las jaulas cubren las 81 celdas sin repetir ninguna, hay jaulas de 1 a 6 celdas (las de 1 celda equivalen a un número dado) y la cantidad de números iniciales baja con la dificultad (31 en fácil, 26 en media, 10 en difícil, 0 en experto).
- **[Inferido]** Los niveles que entrega la API tienen el mismo formato, porque el mismo código los prepara para jugar. No se vio una respuesta real.
- **[Visto en el código, E2]** **La solución completa está en el navegador** durante toda la partida y la validación de cada jugada se hace ahí (ver sección 5).

## 3. Niveles de dificultad

- **[Observado, E1, E4]** Killer tiene 4 niveles, cada uno con su dirección: fácil (`/es/killer/facil/`), media (`/es/killer/normal/`), difícil (`/es/killer/dificil/`) y experto (`/es/killer/experto/`). `/es/killer` abre fácil.
- **[Visto en el código, E2]** El modo clásico tiene 6 niveles (agrega "diabólico" y "extremo"); killer solo 4.
- **[Observado, E4]** Hay un menú de "Nueva partida" que permite elegir modo (clásico o killer) y dificultad, y avisa que el progreso actual se perderá.
- **[Inferido]** La dificultad la decide el servidor al clasificar sus niveles; el cliente no la calcula.

## 4. Selección y teclado

- **[Observado, E4]** Las flechas del teclado mueven la celda seleccionada una posición, y las teclas numéricas escriben en la celda seleccionada: los aciertos y errores del escenario B cayeron exactamente en las celdas planificadas.
- **[Inferido, E4]** Un clic en el tablero selecciona la celda bajo el puntero (el clic en el centro dejó seleccionada la celda central, según los movimientos siguientes).
- **[Visto en el código, E2]** Teclas: 1 a 9 (fila superior o teclado numérico) escriben; 0, Retroceso y Suprimir borran; las flechas mueven. El tablero se dibuja en un `<canvas>`, así que las celdas no existen como elementos del DOM.

## 5. Entrada de números, validación y errores

- **[Visto en el código, E2]** Cada número se compara al instante con la solución que está en el navegador. Si no coincide, se suma un error. No hay consulta al servidor.
- **[Observado, E4]** El contador "Errores" empieza en 0/3 y sube con cada número incorrecto, **tenga o no un conflicto visible**: en el escenario B subió con un número repetido en la fila, con un número sin conflicto visible y con un número repetido en la columna.
- **[Observado, E4]** Escribir otro número incorrecto en la **misma** celda cuenta como un error nuevo.
- **[Observado, E4]** Los números incorrectos no restan puntos (la puntuación quedó igual tras los tres errores).
- **[Visto en el código, E2]** Escribir en una celda el mismo número que ya tiene, la vacía (funciona como interruptor).
- **[Visto en el código, E2]** El límite de errores sale de un ajuste con valor por defecto 3.

## 6. Vidas y fin de partida

- **[Observado, E4]** Al tercer error se muestra el aviso "Fin de la partida" ("Has cometido tres errores y has perdido esta partida") con dos opciones: "Segunda oportunidad" y "Nueva partida". El temporizador se detiene.
- **[Inferido, E2]** "Segunda oportunidad" resta un error y deja seguir jugando; el código lo vincula a ver un anuncio con recompensa.
- **[Inferido]** No hay "vidas" como concepto aparte: son los errores restantes hasta el límite.

## 7. Resaltado

- **[Visto en el código, E2]** Al seleccionar una celda se resaltan:
  - su fila, su columna y su caja de 3×3;
  - las demás celdas con el mismo número;
  - las celdas con números en conflicto o incorrectos.
- **[Visto en el código, E2]** Cada uno de esos tres resaltados se puede desactivar desde los ajustes (`localStorage.game_settings`) y viene activado por defecto.
- **[Visto en el código, E2]** En killer se dibujan los bordes de cada jaula y su suma en una de sus celdas (la primera de su lista).
- **[Inferido]** **No hay un resaltado específico de la jaula de la celda seleccionada.** Una búsqueda acotada en el código no lo encontró, y las opciones de resaltado solo nombran fila, columna, caja, números iguales y duplicados.

## 8. Notas

- **[Visto en el código, E2]** Un control de lápiz activa el modo notas. En ese modo, un número se guarda como candidato de la celda y deja la celda sin valor.
- **[Visto en el código, E2]** **Limpieza automática de notas:** al escribir un número en una celda, se borra ese número de las notas de las celdas de su **fila, columna y caja**. **La jaula no se incluye.** La limpieza se activa al escribir el número, sin revisar si es correcto. También ocurre al usar una pista.
- **[Visto en el código, E2]** La limpieza automática depende de un estado interno que vale "activado" por defecto.
- **[Inferido]** Las notas son solo personales: no hay notas compartidas ni varias capas.

## 9. Deshacer y borrar

- **[Visto en el código, E2]** **Deshacer** revierte la última jugada: devuelve el valor y las notas de la celda, y también las notas de las celdas vecinas que la limpieza automática había borrado. El código no descuenta el error ni la puntuación de esa jugada.
- **[Visto en el código, E2]** **Borrar** solo actúa sobre celdas editables con valor o con notas, y las deja vacías. Los números iniciales y los colocados por una pista no se pueden borrar.
- **[Visto en el código, E2]** La partida lleva la cuenta de cuántas veces se usó deshacer y borrar.

## 10. Pistas

- **[Observado, E4]** El contador de pistas empieza en 3.
- **[Visto en el código, E2]** En killer, una pista coloca el valor correcto en la celda seleccionada si es editable, y la deja bloqueada. Si la celda no es editable, no hace nada.
- **[Visto en el código, E2]** Usar una pista **suma puntos** (el valor base de la dificultad por el multiplicador de la sección 12) y resta una pista disponible.
- **[Visto en el código, E2]** El modo clásico tiene además "pistas inteligentes" que explican una técnica en lugar de dar el número; en killer no se usan.
- **[Inferido, E2]** Cuando las pistas se agotan, se pueden recuperar viendo un anuncio (el código tiene una operación para agregar pistas gratis).

## 11. Temporizador y pausa

- **[Observado, E4]** El temporizador corre desde que se carga la partida, no desde la primera jugada. Tras una carga de unos 100 s, el escenario B ya marcaba 01:38 antes de tocar nada.
- **[Observado, E4]** El temporizador avanza durante la partida y se detiene en el fin de partida: marcó 01:46 en dos pasos separados por 2,5 s.
- **[Visto en el código, E2]** Hay un control de pausa y una pantalla de pausa con botón para reanudar.
- **[Inferido, E2]** La pausa también se activa sola en algunas situaciones (el código tiene un estado de pausa automática, asociado a anuncios o a ocultar la pestaña).

## 12. Puntuación

- **[Observado, E4]** Solo los aciertos suman puntos. En el escenario B los tres aciertos sumaron +5, +50 y +50 (total 105).
- **[Visto en el código, E2]** **Fórmula:**
  - Puntos de un acierto = máx(base − paso × ⌊segundos desde la jugada anterior / 5⌋, mínimo).
  - El resultado se multiplica por 5 por cada fila, columna o caja que la jugada completa. Si no completa ninguna, el multiplicador es 1.
  - Valores (base / mínimo / paso):
    - fácil: 50 / 5 / 5
    - media: 150 / 15 / 15
    - difícil: 210 / 21 / 21
    - experto: 230 / 23 / 23
- **[Inferido]** El +5 del primer acierto se explica porque habían pasado unos 100 s desde el inicio, y el valor cayó a su mínimo. Los +50 siguientes llegaron menos de 5 s después de la jugada anterior. Es un modelo que **premia la velocidad**: favorece hacer rápido las celdas fáciles.
- **[Observado, E4]** La mejor puntuación se guarda en `localStorage.best_score` y se actualiza con cada acierto.

## 13. Contador de dígitos restantes

- **[Observado, E4]** No hay un número de "quedan N" por dígito. Cuando las 9 apariciones de un dígito están colocadas, su tecla del teclado numérico en pantalla queda deshabilitada (pasó con el 5 al completarlo).
- **[Visto en el código, E2]** Mientras un dígito está completo, el teclado físico también ignora ese número, salvo en una celda que ya lo tenga.

## 14. Persistencia de la partida

- **[Observado, E4]** Cada número escrito, correcto o incorrecto, actualiza `localStorage.main_game_killer`. Moverse por el tablero no la actualiza.
- **[Visto en el código, E2]** Al volver a la página se recupera la partida guardada si es del mismo modo y dificultad y no estaba terminada.
- **[Inferido]** El progreso vive solo en el navegador; el servidor solo recibe la estadística de fin de nivel.

## 15. Observaciones manuales del autor

> **Descartada: las reglas propias ya cubren estos puntos** (decisión del autor, 2026-10-22). Las reglas del proyecto están en `docs/PLAN.md` (sección 2) y `docs/SPEC.md`.

---

## Notas para F2 (no son comportamiento de la referencia)

- La referencia tiene **la solución en el navegador** y valida ahí. Nuestro proyecto exige lo contrario (servidor autoritativo). No se puede tomar como modelo de arquitectura.
- Su limpieza automática de notas **no incluye la jaula**. Nuestra regla de la sección 2 del plan sí la incluye.
- Su puntuación premia la velocidad, que es justo lo que nuestro modelo de F6 quiere evitar. Sirve como modelo de comparación (ver F6 en el plan).
- Admite jaulas de 1 celda, números iniciales en killer y jaulas de hasta 6 celdas. Nuestro generador (F4) prevé jaulas de 2 a 5 celdas. Hay que decidir en F2 si se mantiene ese rango.

## Preguntas abiertas

Cosas que **no se vieron funcionando** (solo se conocen por el código o por inferencia) y dudas sin resolver:

1. **Respuesta real de `/api/level`:** ¿tiene exactamente los campos de los niveles incluidos en el bundle? ¿Trae siempre la solución completa?
2. **Notas en ejecución:** activar el modo notas, agregar y quitar candidatos, y comprobar que la limpieza automática borra en fila, columna y caja pero **no** en la jaula.
3. **¿La limpieza automática de notas se dispara también con un número incorrecto?** El código parece indicar que sí.
4. **¿La limpieza automática de notas se puede desactivar** desde los ajustes? No se encontró el ajuste.
5. **Resaltado de la jaula seleccionada:** ¿realmente no existe? Solo se hizo una búsqueda acotada en el código.
6. **Deshacer en ejecución:** ¿devuelve las notas vecinas? ¿Deshacer una jugada incorrecta descuenta el error? (El código dice que no.)
7. **¿Se puede borrar o sobrescribir un número correcto** escrito por el jugador?
8. **Pista en ejecución:** puntos que suma, bloqueo de la celda y qué pasa al llegar a 0 pistas.
9. **Pausa en ejecución:** ¿oculta el tablero? ¿Cuándo se activa la pausa automática?
10. **"Segunda oportunidad":** ¿resta exactamente un error? ¿Exige siempre ver un anuncio? ¿Cuántas veces se puede usar por partida?
11. **El ajuste de "comprobar errores" (`checkMistakes`)**, ¿desactiva el conteo de errores en killer?
12. **Multiplicador por completar áreas:** ¿se suma (5 por área) o se multiplica cuando una jugada completa fila y columna a la vez? Se infiere que se suma.
13. **¿El temporizador sigue corriendo con la pestaña oculta?**
14. **Cambio de dificultad en ejecución:** la navegación a experto no se completó (límite de 45 s por la carga de anuncios).

## Límites del estudio

- La página carga mucha publicidad (unos 100 s por carga en el navegador controlado). Eso agotó los límites de registro de REA y obligó a exportar la evidencia en lugar de leerla en línea.
- El tablero es un `<canvas>`: notas y resaltados no se ven en el DOM. Como el entregable no admite capturas, no se usaron capturas de pantalla para verificarlos.
- Los valores de `localStorage` llegan como hashes en la evidencia (REA no guarda valores). Solo se pudo ver **cuándo** cambia cada clave, no su contenido.
- El código del sitio está minificado. Las lecturas de código son exactas en lo que citan, pero no demuestran que esa rama se ejecute en todos los casos.
