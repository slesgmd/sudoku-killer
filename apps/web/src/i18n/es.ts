// Textos de la interfaz en español (catálogo propio, ADR 0001, nota de F8). Las variables van entre
// llaves; los plurales, como `{ one, other }` según `count`. Coinciden con los del prototipo de F7.
export type Message = string | { readonly one: string; readonly other: string };

export const es = {
  appTitle: "Sudoku Killer",

  // Cabecera fuera de la partida
  "app.help": "Ayuda",
  "app.settings": "Ajustes",
  "app.nav": "Ayuda y ajustes",
  "home.repository": "Código fuente en GitHub",

  // Inicio (design/pantallas.md §1.1)
  "home.title": "Un tablero, varias cabezas.",
  "home.lead":
    "Sudoku killer cooperativo y en tiempo real, para hasta seis personas. Sin cuentas: basta un código de sala y un apodo.",
  "home.enter": "Entrar o crear sala",
  "home.enterOther": "Entrar o crear otra sala",
  "home.resume": "Volver a la sala {code}",
  "home.resumeHint": "Recuperas tus vidas, puntos y notas si queda un asiento libre.",
  "home.howTo": "Cómo se juega",
  "home.gone": "La sala {code} ya no existe.",
  "home.goneText": "Las salas se borran tras 2 minutos sin nadie conectado.",
  "home.full": "La sala {code} no tiene asientos libres.",
  "home.fullText": "Se ocuparon los 6 mientras no estabas. Prueba más tarde o crea otra sala.",
  "home.factPlayers": "Jugadores",
  "home.factPlayersValue": "Hasta 6",
  "home.factLives": "Vidas",
  "home.factLivesValue": "3 cada uno",
  "home.factHints": "Pistas",
  "home.factHintsValue": "3 por equipo",

  // Entrar o crear (design/pantallas.md §1.2)
  "enter.back": "Inicio",
  "enter.title": "Entrar o crear una sala",
  "enter.lead": "Elige un apodo. Después entra con el código que te pasaron o crea una sala nueva.",
  "enter.nickname": "Tu apodo",
  "enter.nicknameHint": "De 2 a 16 caracteres. Tiene que ser único en la sala.",
  "enter.nicknameInvalid": "El apodo tiene que tener entre 2 y 16 caracteres.",
  "enter.nicknameTaken":
    "«{nickname}» ya está en uso en esta sala, o reservado hasta que termine la partida en curso. Elige otro apodo.",
  "enter.withCode": "Entrar con código",
  "enter.code": "Código de la sala",
  "enter.codeHint":
    "6 caracteres. Se escriben en mayúsculas solos; los códigos no usan 0, O, 1, I ni L.",
  "enter.codeRejected": "La «{char}» no se usa en los códigos y no se añadió.",
  "enter.codeIncomplete": "El código tiene 6 caracteres.",
  "enter.codeNotFound":
    "No hay ninguna sala con el código {code}. Revisa el código o crea una sala nueva.",
  "enter.join": "Entrar",
  "enter.entering": "Entrando…",
  "enter.or": "o",
  "enter.create": "Crear sala nueva",
  "enter.createHint": "Recibirás un código para invitar a hasta 5 personas más.",
  "enter.fullTitle": "Sala llena.",
  "enter.fullText":
    "La sala {code} tiene sus 6 asientos ocupados. Prueba más tarde o crea otra sala.",
  "enter.offlineTitle": "Sin conexión.",
  "enter.offlineText":
    "No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.",
  "enter.retry": "Reintentar",
  "enter.statusJoin": "Entrando en la sala {code}…",
  "enter.statusCreate": "Creando la sala…",

  // Clave de acceso del grupo (F12, R-39)
  "access.title": "Clave del grupo",
  "access.leadMissing":
    "Este juego es privado. Escribe la clave del grupo una sola vez: queda guardada en este dispositivo.",
  "access.leadInvalid":
    "La clave guardada en este dispositivo ya no vale; quizá cambió. Escribe la clave vigente del grupo.",
  "access.label": "Clave",
  "access.hint":
    "Te la pasan junto con el enlace de invitación. Da igual si la escribes en mayúsculas o minúsculas.",
  "access.invalid": "La clave tiene entre 12 y 64 caracteres, sin contar espacios ni guiones.",
  "access.submit": "Continuar",
  "access.back": "Volver al inicio",

  // Inicio mínimo de F8 (arranque directo, solo en las pruebas)
  "home.failedTitle": "No se pudo empezar.",
  "home.failedText": "La partida no terminó de cargar. Revisa tu conexión y vuelve a intentarlo.",

  // Lobby (design/pantallas.md §1.3)
  "lobby.title": "Sala de espera",
  "lobby.leave": "Salir de la sala",
  "lobby.code": "Código de la sala",
  "lobby.copy": "Copiar código",
  "lobby.copied": "Código copiado",
  "lobby.copiedLive": "Código {code} copiado",
  "lobby.share": "Compartir",
  "lobby.linkCopied": "Enlace copiado",
  "lobby.linkCopiedLive": "Enlace a la sala {code} copiado",
  "lobby.codeHint":
    "Quien tenga el código puede entrar mientras queden asientos, también con la partida en curso.",
  "lobby.players": "Jugadores",
  "lobby.seats": "{count} de {total}",
  "lobby.freeSeat": "Asiento libre",
  "lobby.full": "Sala llena: nadie más puede entrar hasta que se libere un asiento.",
  "lobby.difficulty": "Dificultad",
  "lobby.difficultyStarter": "Solo tú puedes cambiarla. Los demás la ven al momento.",
  "lobby.difficultyOther": "La elige {name}, que inicia la partida.",
  "lobby.start": "Iniciar partida",
  "lobby.starting": "Iniciando…",
  "lobby.startHint":
    "Puedes iniciar aunque estés solo. Quien entre después se suma a la partida en curso con 3 vidas.",
  "lobby.waiting": "Esperando a que {name} inicie la partida.",
  "lobby.handoverYou": "{name} salió de la sala. Ahora inicias tú la partida.",
  "lobby.handover": "{name} salió de la sala. Ahora inicia la partida {to}.",
  "lobby.reset": "{name} volvió al lobby para preparar otra partida.",
  "share.title": "Enlace a la sala",
  "share.text": "Copia este enlace y envíalo a quien quieras invitar.",
  "share.codeTitle": "Código de la sala",
  "share.codeText": "Copia el código y pásaselo a quien quieras invitar.",
  "share.label": "Enlace",
  "share.codeLabel": "Código",
  "share.shareText": "Únete a mi sala de Sudoku Killer: {code}",

  // Resultados (design/pantallas.md §1.5)
  "results.kicker": "Partida terminada · {difficulty}",
  "results.victory": "Tablero resuelto.",
  "results.victoryLead": "El equipo completó las {cells} celdas.",
  // Derrota según su causa (SPEC 1.8): todos sin vidas, todos fuera o una mezcla.
  "results.defeat.lives": "Se acabaron las vidas.",
  "results.defeatLead.lives":
    "Todos los jugadores perdieron sus 3 vidas antes de completar el tablero.",
  "results.defeat.gone": "La partida quedó sin jugadores.",
  "results.defeatLead.gone":
    "Todos los jugadores salieron o estuvieron desconectados más de 2 minutos.",
  "results.defeat.mixed": "La partida quedó sin jugadores activos.",
  "results.defeatLead.mixed":
    "Los jugadores que quedaban perdieron sus vidas o salieron de la partida.",
  "results.time": "Tiempo total",
  "results.hints": "Pistas usadas por el equipo",
  "results.hintsValue": "{used} de {total}",
  "results.ranking": "Ranking de la partida",
  "results.position": "Puesto",
  "results.player": "Jugador",
  "results.points": "Puntos",
  "results.mistakes": "Errores",
  "results.positionSr": "Puesto {position}",
  "results.positionTieSr": "Puesto {position}, empate",
  "results.tie": "Empate",
  "results.left": "Salió",
  "results.tieNote":
    "{names} comparten el {position}.º puesto: mismos puntos, mismos errores y alcanzaron esa puntuación a la vez.",
  "results.ruleNote":
    "A igual puntuación va antes quien tiene menos errores y, después, quien llegó antes a esos puntos.",
  "results.toLobby": "Volver al lobby",
  "results.waiting": "Esperando a que {name} vuelva al lobby.",
  "results.leave": "Salir de la sala",
  "results.leaveBody": "Dejarás tu asiento libre y no estarás en la próxima partida.",

  // Ayuda (design/pantallas.md §1.6)
  "help.back": "Volver",
  "help.title": "Cómo se juega",
  "help.lead":
    "Todo lo necesario para jugar en equipo: reglas, vidas, notas, pistas y qué pasa si se corta la conexión.",
  "help.toc": "En esta página",
  "help.rules": "Reglas del killer",
  "help.rules.1":
    "Hay que llenar el tablero de 9 × 9 con los dígitos del 1 al 9 sin repetir ninguno en una fila, una columna ni una caja de 3 × 3.",
  "help.rules.2":
    "Además, las celdas están agrupadas en jaulas, marcadas con una línea discontinua. El número pequeño de la esquina es la suma de las celdas de la jaula, y dentro de una jaula tampoco se repiten dígitos. Cada jaula tiene de 2 a 5 celdas.",
  "help.team": "Juego cooperativo",
  "help.team.1":
    "Todo el equipo, hasta seis personas, resuelve el mismo tablero a la vez. Cada acierto bloquea la celda para siempre y todos lo ven al momento. El equipo gana cuando completa el tablero.",
  "help.team.2":
    "Además, cada persona suma puntos para el ranking de la partida: los aciertos y cerrar filas, columnas, cajas o jaulas suman; los errores y las pistas restan. A igual puntuación va antes quien tiene menos errores y, después, quien llegó antes a esos puntos.",
  "help.team.3":
    "Puedes entrar en una sala con la partida empezada si queda un asiento libre: empiezas con 3 vidas.",
  "help.lives": "Vidas y espectadores",
  "help.lives.1":
    "Cada persona tiene 3 vidas. Un número incorrecto resta una vida y algunos puntos; todo el equipo lo ve tachado un instante, con tu inicial, y después la celda vuelve a quedar vacía.",
  "help.lives.2":
    "Con 0 vidas pasas a espectador: sigues viendo la partida y puedes escribir notas, pero ya no colocas números ni usas pistas. Conservas tus puntos. Si no queda nadie activo (con vidas y conectado, o dentro de los 2 minutos de margen), el equipo pierde.",
  "help.notes": "Capas de notas",
  "help.notes.1":
    "Hay dos capas de notas. Las personales solo las ves tú; las grupales las ve todo el equipo. En modo Notas eliges en qué capa escribes y, con el ojo, qué capas se muestran.",
  "help.notes.2":
    "Las grupales se ven en negrita; las personales, subrayadas y en verde oliva; una nota en las dos capas, en negrita y subrayada.",
  "help.notes.3":
    "Deshacer solo afecta a tus propias notas. Si otra persona cambió esa nota después, no se deshace y te lo decimos.",
  "help.notes.4":
    "Cuando alguien acierta un número, se quita de las notas grupales de su fila, columna, caja y jaula. En tus notas personales también, salvo que lo desactives en Ajustes.",
  "help.hints": "Pistas",
  "help.hints.1":
    "El equipo comparte 3 pistas por partida. Elige una celda vacía y pide una pista: se coloca el número correcto. La pista resta puntos a quien la usa y no da bonus, así que siempre se pide confirmación. Los espectadores no pueden usarlas.",
  "help.simultaneous": "Jugadas simultáneas",
  "help.simultaneous.1":
    "Si dos personas escriben en la misma celda a la vez, cuenta la jugada que llega primero al servidor. Si era un acierto, la otra no cuenta y no quita vida.",
  "help.simultaneous.2":
    "Mientras el servidor responde, el número se ve en gris con tres puntos y la celda no admite otra jugada. Las notas, en cambio, se aplican al momento.",
  "help.disconnect": "Desconexión",
  "help.disconnect.1":
    "Si se corta la conexión, tienes 2 minutos para volver a la misma sala con tu asiento, tus vidas, tus puntos y tus notas. Mientras tanto, tus notas se guardan y se envían al volver.",
  "help.disconnect.2":
    "Pasados los 2 minutos, tu asiento queda libre. Si vuelves desde el mismo navegador y hay sitio, recuperas tus datos. Si sales a propósito, el asiento se libera al momento. Una sala sin nadie conectado durante 2 minutos se borra.",
  "help.keys": "Atajos de teclado",
  "help.keys.arrows": "Mover la selección por el tablero",
  "help.keys.digits": "Escribir un número o una nota, según el modo",
  "help.keys.mode": "Cambiar entre Número y Notas",
  "help.keys.layer": "Cambiar la capa de escritura: personal o grupal",
  "help.keys.clear": "Borrar las notas de la capa activa en la celda",
  "help.keys.undo": "Deshacer tus últimas notas",
  "help.keys.hint": "Pedir una pista (abre la confirmación)",
  "help.keys.escape": "Cerrar un diálogo o un menú",

  "difficulty.easy": "Fácil",
  "difficulty.medium": "Media",
  "difficulty.hard": "Difícil",
  "difficulty.expert": "Experto",
  "difficulty.givensNote": "{count} números iniciales",
  "difficulty.noGivens": "Sin números iniciales",

  // Cabecera
  "head.room": "Sala",
  "head.difficulty": "Dificultad",
  "head.time": "Tiempo",
  "head.hints": "Pistas",
  "head.hintsValue": "{left}/{total}",
  "head.settings": "Ajustes",
  "head.leave": "Salir",
  "head.menu": "Menú: Ajustes, Salir",
  "head.menuLeave": "Salir de la sala",
  "head.activity": "Actividad",

  // Tablero y celdas
  "board.label": "Tablero",
  "cell.position": "Fila {row}, columna {col}",
  "cell.short": "F{row} C{col}",
  "cell.cage": "jaula de {sum}",
  "cell.empty": "vacía",
  "cell.given": "{value}, número inicial",
  "cell.solved": "{value}, resuelta por {name}",
  "cell.solvedYou": "{value}, resuelta por ti",
  "cell.hintYou": "{value}, pista usada por ti",
  "cell.hint": "{value}, pista usada por {name}",
  "cell.pending": "{value}, pendiente de confirmación",
  "cell.mistake": "vacía; {name} acaba de fallar con un {digit}",
  "cell.groupNotes": "notas grupales {digits}",
  "cell.personalNotes": "notas personales {digits}",
  "cell.sameDigit": "mismo número que la celda seleccionada",
  "cell.presence": "{names} está aquí",
  "cell.presenceMany": "{names} están aquí",
  magnifier: "Lupa · {cell}",

  // Controles
  "mode.label": "Modo de entrada",
  "mode.number": "Número",
  "mode.notes": "Notas",
  "layer.label": "Capa de escritura",
  "layer.personal": "Personal",
  "layer.group": "Grupal",
  "visibility.label": "Mostrar notas",
  "visibility.personal": "Notas personales",
  "visibility.personalShort": "Personales",
  "visibility.group": "Notas grupales",
  "visibility.groupShort": "Grupales",
  "visibility.shown": "visibles",
  "visibility.hidden": "ocultas",
  "tool.clear": "Borrar",
  "tool.clearLabel": "Borrar las notas de la capa {layer} en la celda",
  "tool.undo": "Deshacer",
  "tool.undoLabel": "Deshacer tus últimas notas",
  "tool.hint": "Pista",
  "tool.hintLabel": "Pista, quedan {left}",
  "tool.hintSpectator": "Pista no disponible para espectadores",
  "tool.hintNone": "Pista: no quedan pistas",
  "tool.hintPickEmpty": "Pista: elige una celda vacía",
  "key.number": "Número {digit}, {remaining}",
  "key.note": "Nota {digit}, {remaining}",
  "key.remaining": { one: "queda {count}", other: "quedan {count}" },
  "key.done": "completo",
  "key.unavailable": "no disponible ahora",
  "keypad.label": "Teclado numérico",

  // Jugadores
  "players.label": "Jugadores",
  "players.swipe": "Desliza para ver todos",
  "players.you": "tú",
  "players.lives": "{lives} vidas de {total}",
  "players.pointsUnit": "puntos",
  "players.spectator": "Espectador",
  "players.disconnected": "Desconectado",
  "players.left": "Salió",
  "players.starter": "Inicia la partida",
  "players.freeSeats": { one: "{count} asiento libre", other: "{count} asientos libres" },

  // Actividad
  "activity.label": "Actividad",
  "activity.empty": "Todavía no hay jugadas.",
  "activity.gap": "La actividad anterior a la reconexión no está disponible.",
  "activity.open": "Ver actividad",
  "activity.solved": "{name} · acierto en {cell}",
  "activity.mistake": "{name} · error en {cell}",
  "activity.hint": "{name} · pista en {cell}",
  "activity.joined": "{name} entró en la partida",
  "activity.left": "{name} salió de la sala",
  "activity.spectator": "{name} pasó a espectador",

  // Estados (docs/diseno.md §9)
  loading: "Cargando la partida…",
  "state.ownMistake": "El {digit} no va en {cell}. {lives}",
  "state.livesLeft": { one: "Te queda {count} vida.", other: "Te quedan {count} vidas." },
  "state.nowSpectator":
    "Te quedaste sin vidas. Ahora eres espectador: puedes seguir escribiendo notas.",
  "state.spectatorNotice": "Eres espectador: solo puedes escribir notas.",
  "state.alreadySolved":
    "{name} resolvió {cell} un instante antes. Tu jugada no cuenta y no pierdes vida.",
  "state.alreadySolvedAnon": "{cell} ya estaba resuelta. Tu jugada no cuenta y no pierdes vida.",
  "state.hintForbidden": "No se usó la pista: ya eres espectador y solo puedes escribir notas.",
  "state.placeForbidden":
    "No se colocó el número: ya eres espectador y solo puedes escribir notas.",
  "state.hintNone": "No se usó la pista: el equipo ya no tiene pistas.",
  "state.rateLimited":
    "Vas muy rápido: la última acción no se envió. Espera un momento y repítela.",
  "state.undoModifiedGroup": "No se pudo deshacer: otra persona cambió esa nota grupal después.",
  "state.undoModifiedPersonal": "No se pudo deshacer: una limpieza automática cambió esa nota.",
  "state.undoLocked": "No se pudo deshacer: la celda ya está resuelta.",
  "state.recovered": "Se recuperaron {done} de {total} notas.",
  "state.recoveredRest": {
    one: "La otra cambió después de que la borraras.",
    other: "Las otras {count} cambiaron después de que las borraras.",
  },
  "state.nothingToUndo": "No hay notas tuyas para deshacer.",
  "state.error": "No se pudo completar la acción ({code}).",
  "state.reconnected": "Conexión recuperada.",
  "state.reconnectedQueued": {
    one: "Conexión recuperada. Se envió {count} nota en cola.",
    other: "Conexión recuperada. Se enviaron {count} notas en cola.",
  },
  "net.reconnecting": "Reconectando…",
  "net.reconnectingText": "Los números se bloquean hasta entonces.",
  "net.reconnectingNotes": "Tus notas se guardan y se enviarán al volver.",
  "net.reconnectingQueued": "Tus notas se guardan y se enviarán al volver ({count} en cola).",
  "net.reconnectingRoom": "Lo que pase en la sala se verá al volver.",
  "net.unavailable": "El servidor no responde.",
  "net.unavailableText": "Lo que hagas no se registrará hasta que vuelva. Reintentando…",
  "net.replacedTitle": "La sala está abierta en otra pestaña",
  "net.replacedText":
    "Solo una pestaña puede jugar a la vez, y esta quedó desconectada. Tus vidas, puntos y notas siguen intactos.",
  "net.replacedAction": "Jugar en esta pestaña",
  "net.versionTitle": "Hay una versión nueva del juego",
  "net.versionText":
    "Esta pestaña usa una versión anterior y no puede comunicarse con el servidor. Recarga para seguir: conservas tu asiento durante 2 minutos.",
  "net.versionAction": "Recargar",
  "state.joinedRunning":
    "Entraste en una partida en curso: empiezas con 3 vidas y 0 puntos. Las notas grupales ya están a la vista.",
  "ended.victory": "La partida terminó. El equipo completó el tablero en {time}.",
  "ended.defeat": "La partida terminó. {reason}",
  "ended.results": "Ver resultados",

  // Diálogos
  "dialog.close": "Cerrar",
  "dialog.cancel": "Cancelar",
  "hint.title": "¿Usar una pista en {cell}?",
  "hint.cost": "Cuesta −{points} puntos a quien la usa y no da bonus.",
  "hint.left": {
    one: "Queda {count} pista para todo el equipo.",
    other: "Quedan {count} pistas para todo el equipo.",
  },
  "hint.confirm": "Usar pista",
  "leave.title": "¿Salir de la sala?",
  "leave.body": "Tu asiento queda libre al momento.",
  "leave.starter": "El derecho de iniciar pasará a {name} y no vuelve a ti aunque regreses.",
  "leave.stay": "Quedarme",
  "leave.confirm": "Salir de la sala",
  "settings.title": "Ajustes",
  "settings.useNotes": "Usar notas",
  "settings.useNotesHelp":
    "Si lo desactivas, se ocultan las notas y sus controles, y solo colocas números. Se guarda solo en este navegador.",
  "settings.autoClean": "Limpiar notas personales automáticamente",
  "settings.autoCleanHelp":
    "Cuando alguien acierta un número, ese número se quita de tus notas personales en su fila, columna, caja y jaula. Las notas grupales se limpian siempre.",
  "settings.on": "Sí",
  "settings.off": "No",
  "settings.motion": "El movimiento reducido sigue la preferencia de tu sistema.",
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof es;
