# Revisión de seguridad

Revisión del servidor de salas, del cliente y de las dependencias (2026-10-25), completada con el despliegue. Política: los hallazgos críticos, altos y medios se corrigen antes de exponer el juego; los bajos se corrigen o se aceptan con su motivo.

**Severidad:** crítica (compromete datos o el servidor sin condiciones), alta (explotable desde internet con impacto serio), media (explotable con condiciones o con impacto acotado, como la disponibilidad), baja (impacto menor o que requiere otra falla), informativa (sin riesgo; se deja constancia).

## 1. Lista de revisión

| Punto | Qué se revisó | Resultado |
|---|---|---|
| Validación con Zod | Todo mensaje entrante pasa por `parseClientEnvelope` (`packages/protocol`): sobre, tipo conocido y `payload` con `z.strictObject`. JSON inválido, binario, tipo desconocido o campos de más reciben `bad_request` sin cambiar el estado; otra versión, `protocol.unsupported` y 4000. | Sin hallazgos. Pruebas: T-10.2, T-16.1, E-18, E-19 y los ejemplos válidos e inválidos de cada mensaje (SPEC §8.4). |
| Límites de velocidad | Cubetas por conexión (§4.8), aplicadas **antes** de validar; presencia y ping con cubetas propias que descartan sin aviso. | Sin hallazgos en la conexión. **S-01:** no había tope de conexiones ni de salas por instancia (corregido). La prueba de carga en estrés (20 comandos por segundo por conexión) no recibió `rate_limited`, como corresponde. |
| `maxPayload` | 16 KiB en `WebSocketServer`, cierre 1009; `perMessageDeflate` desactivado (sin bombas de compresión). | Sin hallazgos. Prueba E-18 (1009). |
| Orígenes | `Origin` obligatorio y en la lista (`ALLOWED_ORIGINS`, R-41), si no 403; solo `/ws` acepta el handshake (404 en otra ruta). | Sin hallazgos como control de navegador. **S-02:** el origen no autentica (corregido con la clave del grupo). |
| Filtración de la solución | Inspector de filtración en todas las pruebas I y E2E (claves `solution`, `token` y `tokenHash`; la solución serializada; `value` de celdas no bloqueadas); `check-dist` en cada build (T-31.2). | Sin hallazgos. T-31.1, T-31.2, T-31.3, control del inspector en E2E y las pruebas de caos. |
| Filtración de fichas | Fichas de 128 bits (`node:crypto`), solo `token` en el `room.welcome` de su dueño; el arnés de pruebas falla si una ficha o un hash aparecen en el log. | Sin hallazgos. T-13.4 (I) en memoria y en la base. |
| Filtración de notas personales | Regla 4 del inspector: notas personales de un jugador en un mensaje a otro. | Sin hallazgos. R-29 y el inspector en I, E2E y caos. |
| Errores sin detalles internos | Una falla en la cola de una sala responde `server.unavailable`; el detalle y un `errorId` solo van al log, con `redact`. El HTTP responde 403, 404 o 503 sin cuerpo. Los errores de configuración nombran la variable, nunca su valor. | Sin hallazgos. |
| Fichas solo como hash | La base y el registro guardan el SHA-256 (`tokenHash`), nunca la ficha. | Sin hallazgos. T-13.4 (I). |
| Secretos | `DATABASE_URL` solo por el entorno; rol de la base sin privilegios; nada se registra en el log. | Sin hallazgos. |
| Cliente | Sin `innerHTML`, `dangerouslySetInnerHTML` ni `eval`; React escapa el texto (apodos incluidos). | **S-05** (ficha en `localStorage`, corregido). |
| Dependencias | `pnpm audit` (2026-10-25). | **S-04** (esbuild en drizzle-kit, bajo). |

## 2. Hallazgos

| ID | Severidad | Hallazgo | Estado |
|---|---|---|---|
| S-01 | Media | **Sin tope de conexiones ni de salas por instancia.** Cualquiera que llegue al puerto podía abrir conexiones sin límite y crear una sala por conexión (cada sala vacía vive 120 s), hasta agotar la memoria del servidor (disponibilidad). | **Corregido:** tope de 2 000 conexiones abiertas (el handshake recibe 503) y de 500 salas (`room.create` recibe `server.unavailable`, un código que ya existía: el protocolo no cambia). Valores en SPEC §4.8. Pruebas S-01 en `ws.test.ts`, con verificación negativa. **Tope por IP** (con el despliegue, porque detrás del proxy del hosting la IP del cliente sale de una cabecera): 40 conexiones por IP (503), con la IP de `X-Forwarded-For` contando `TRUST_PROXY_HOPS` desde la derecha (lo que el cliente escribe a la izquierda no cuenta); `TRUST_PROXY_HOPS=1` en Render, confirmado en producción. Si estuviera mal, todos compartirían la IP del proxy: el tope de 40 sigue alcanzando para el grupo. **Tras el primer despliegue:** en Render, cada intento recibía 429 sin que el navegador hubiera mandado clave. Ahora solo cuenta una clave ofrecida que no vale (sin clave, siempre 4003), una IP que no se puede saber (cabecera ausente o corta, o una entrada que no es una IP) no comparte espera ni tope con nadie, y el 429 lleva `Retry-After` (T-39.7 a T-39.9). La línea `metrics` suma `accessLocked` y `addressUnknown` para confirmar `TRUST_PROXY_HOPS`. |
| S-02 | Alta en internet con datos sensibles; **aceptada** con el acceso abierto | **Sin autenticación: el código de sala es la única barrera.** El `Origin` lo falsifica cualquier script. Con conexiones sin límite por IP, se pueden probar códigos (31⁶ ≈ 887 millones; con 50 salas, uno de cada 18 millones acierta) y entrar a una sala ajena. | **Corregido** antes de exponer el juego: clave de acceso del grupo en el handshake (subprotocolo `sk.k.`), hash SHA-256 en `ACCESS_KEY_HASH` (obligatorio en producción), cierre 4003, 10 intentos por IP cada 10 min (después, 429), pantalla «Clave del grupo» y enlace de invitación `#k=` (SPEC R-39). Tras el despliegue, el cliente comprueba la clave con `POST /access` (cabecera, nunca la URL; CORS solo para `ALLOWED_ORIGINS`; mismos intentos y espera que el handshake) antes de abrir el WebSocket, porque el proxy de Render pierde el 4003 (T-39.12 a T-39.16). La clave tiene 80 bits si la genera `access:key`; una propia, al menos 12 caracteres. **Reabierto y aceptado (2026-11-03):** el juego pasa a ser público a propósito, así que la clave es opcional. Se acepta porque una sala no guarda datos personales (apodo sin cuenta) y entrar a una ajena solo permite jugar en ella. Mitigaciones: límites por IP (sección 5), `ACCESS_OPEN=true` obligatorio para arrancar sin clave en producción, y la vuelta a acceso cerrado poniendo otra vez `ACCESS_KEY_HASH` (ADR 0007). |
| S-03 | Baja | **Apodos con caracteres invisibles o de control.** NFKC no quita los de ancho cero (U+200B) ni los de dirección (U+202E): «Ana» y «Ana​» son apodos distintos en la misma sala y se ven iguales (suplantación visual entre conocidos). | **Aceptado:** filtrarlos cambia la regla D2 del apodo (decisión de producto). React los muestra como texto, sin riesgo de inyección. El motivo original (un grupo cerrado de conocidos) dejó de valer con el acceso abierto; se mantiene porque el apodo no identifica a nadie y una sala dura lo que dura la partida. En la beta cerrada (15 personas, 2026-10-26 a 2026-10-28) no hubo casos. Filtrarlos queda en `docs/IDEAS_FUTURAS.md`. |
| S-04 | Baja | **`pnpm audit`: esbuild ≤ 0.24.2 (GHSA-67mh-4wv8-2f99, moderada en el aviso)**, por `drizzle-kit > @esbuild-kit/core-utils`. La falla es del servidor de desarrollo de esbuild, que drizzle-kit no levanta; solo se usa en `db:generate`, en la máquina de desarrollo. | **Aceptado:** no afecta a producción ni al build. Se revisa cuando drizzle-kit deje de depender de `@esbuild-kit` (un `override` podría romperlo, porque está abandonado); las alertas de Dependabot avisan si cambia la severidad. |
| S-05 | Baja | **La ficha vive en `localStorage`**: un XSS la podría leer. Hoy no hay sumideros de HTML ni contenido de terceros. | **Corregido:** el sitio estático sirve una CSP restrictiva (`default-src 'none'`; scripts, estilos, imágenes y fuentes solo del sitio; `connect-src` solo del sitio y del servidor de salas; `frame-ancestors 'none'`, `base-uri` y `form-action` en `'none'`), HSTS (en `onrender.com`, Render la reemplaza por la suya, más estricta: diez años, `includeSubdomains` y `preload`; la prueba de humo acepta una igual o más estricta), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP y `Permissions-Policy`. Una sola fuente (`apps/web/scripts/security-headers.ts`) para `render.yaml`, `vite preview` y `smoke`; todas las E2E fallan ante una violación de la CSP, con una prueba de control (un script en línea bloqueado). Un XSS no podría leer y enviar la ficha a otro sitio. |
| S-06 | Baja | **Plazos del HTTP por defecto de Node** (60 s para las cabeceras): conexiones lentas a propósito ocupan sockets antes del handshake. El tope de S-01 acota el daño. | **Corregido:** `headersTimeout` y `requestTimeout` de 10 s (408), revisados cada segundo; no cortan un WebSocket abierto. Pruebas con verificación negativa. |
| S-07 | Informativa | Sin TLS en desarrollo (`ws://`). | **Resuelto en el despliegue:** HTTPS y WSS con el TLS de Render; el build de producción solo acepta `VITE_SERVER_URL` con `wss://`. |
| S-08 | Media | **Abuso de recursos del plan gratuito con el acceso abierto.** Sin clave, cualquiera puede abrir conexiones y crear salas, y consumir la CPU (0,1), la memoria (512 MB) y las horas de Render, o agotar el cómputo mensual de Neon (sección 7). | **Mitigado y aceptado:** límites por IP (sección 5) y revisión manual del cómputo la primera semana (sección 7). Frenan, no impiden: con muchas IP se pueden llenar las 500 salas. La salida es volver a acceso cerrado (ADR 0007). |
| S-09 | Media | **Crecimiento de la base.** El registro solo agrega filas (ADR 0003 y 0004) y no hay purga. Sin topes, un bot con una IP escribiría unos 272 KB/s y llegaría a 700 MB de la consola de Neon en unos 41 min. | **Mitigado:** topes de eventos por partida y presupuesto de comandos por IP (sección 6), con aviso por correo según `DB_ALERT_BYTES` (sección 6). La purga queda en `docs/IDEAS_FUTURAS.md`. |
| S-10 | Baja | **Un extraño que entra a una sala no puede ser expulsado (R-10).** Quien tenga el enlace o el código ocupa un asiento, puede poner notas grupales y fallar a propósito. No hay moderación ni cuentas. | **Limitación aceptada:** el grupo puede crear otra sala con otro código. El tope por jugador evita que agote el de los demás (T-40.17). |

## 3. Despliegue

### Retención de la base en Neon
- **Riesgo:** la [página de regiones de Neon](https://neon.com/docs/introduction/regions) (consultada el 2026-10-25) dice que los proyectos del plan gratuito con 90 días o más sin uso pueden borrarse desde el 2026-10-05. La nota está junto a las regiones de Azure retiradas y no queda claro si alcanza a AWS us-east-1, la región elegida (ADR 0007); se toma como si aplicara. Neon no define «uso»: lo más cercano es la última actividad del cómputo de cada rama ([ramas](https://neon.com/docs/manage/branches)), que se enciende con cualquier conexión ([escala a cero](https://neon.com/docs/introduction/scale-to-zero)).
- **Mitigación:** el respaldo semanal (`backup.yml`) se conecta y lee todas las tablas: cuenta como uso, igual que una partida.
- **Comprobación:** tras el primer respaldo programado, la «última actividad» de la rama principal en la consola de Neon coincide con la hora del job. Se repite una vez al mes.
- **Riesgo encadenado:** GitHub desactiva los workflows programados de un repositorio público tras 60 días sin actividad ([GitHub Docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)). Quedarían 30 días antes de los 90 de Neon; la revisión mensual lo detecta.

### Dominio propio de la web

La web puede servirse también desde un dominio propio configurado en Render (R-41). El servidor de salas y la dirección de `onrender.com` no cambian, y esta sigue de respaldo.

- **Dónde vive:** solo en el panel de Render (`ALLOWED_ORIGINS` y dominios del sitio estático) y en el DNS. No se escribe en ningún archivo del repositorio, y T-41.5 lo comprueba. Eso no lo hace secreto: es visible en el DNS y en los registros públicos de certificados.
- **`ALLOWED_ORIGINS` con `sync: false`:** una sincronización del Blueprint sobrescribe lo que choque con `render.yaml`, así que un valor fijado allí podría quitar el dominio y dejar en 403 a quien entre por él. Si la variable faltara, o tuviera un valor que un navegador nunca envía, el arranque falla y Render conserva el despliegue anterior.
- **Prueba de humo:** con `custom_domain`, `smoke.yml` repite la prueba desde el dominio. Su dirección es el secreto `SMOKE_CUSTOM_WEB_URL`, no una variable ni una entrada, porque los logs públicos muestran el `env` de cada paso y solo un secreto sale enmascarado.
- **Al retirar el dominio:** se quita también de `ALLOWED_ORIGINS`. Si no, quien lo registrara después serviría una web desde un origen permitido.

### Logs públicos de Actions
- **Riesgo:** el repositorio es público, y con él los logs de cada workflow. Un `pg_dump`, un error de conexión o un `set -x` pueden imprimir la cadena de conexión, una clave, un hash, apodos o filas de la base.
- **Regla:** ningún workflow imprime cadenas de conexión, claves, hashes, apodos ni contenido de la base, solo recuentos. Los pasos que tocan secretos o la base corren con `scripts/ci/quiet.ts`, que retiene la salida en memoria y solo deja pasar líneas de recuento (`clave: número`) y mensajes de la lista. El test `tests/workflow-logs.test.ts` falla si un workflow nuevo usa un secreto o la base fuera de ese envoltorio, o con `set -x`, `env`, `printenv` o `cat`.
- **Artefactos:** los artefactos de un repositorio público los descarga cualquier persona con cuenta de GitHub. Los respaldos se suben cifrados con `age`; la clave privada nunca entra al repositorio.

### Respaldos
- **`backup.yml`** (domingos a las 03:17 de Lima y a mano): `pg_dump` de la base de Neon, restauración en un PostgreSQL 18 efímero del runner (no en un contenedor de servicio, que publicaría su log), comprobación (recuentos y arranque del servidor con la reconstrucción de las partidas) y cifrado con `age` para la clave pública `BACKUP_AGE_RECIPIENT` (variable del repositorio). La cadena de Neon lleva `sslmode=verify-full`, que node-postgres y libpq entienden igual (certificado y nombre verificados); `pg_dump` recibe además `sslrootcert=system` (libpq 16 o posterior), porque sin él buscaría un archivo de raíces que el runner no tiene (prueba `apps/server/test/pg-tools.test.ts`). Solo se sube el archivo cifrado (artefacto `db-backup`, 90 días); el volcado sin cifrar se borra del runner.
- **`restore-drill.yml`** (a mano): baja el último `db-backup`, lo descifra con `BACKUP_AGE_KEY` (secreto de Actions), lo restaura en un PostgreSQL efímero y lo comprueba de la misma forma. No toca producción. Comprueba que restaurar un respaldo funciona.
- **`db-admin.yml`** (a mano): `status`, `migrate` (con la guarda de migraciones destructivas) y `bank-load`.
- **Claves:** la privada de `age` vive en el secreto `BACKUP_AGE_KEY` y en una copia fuera de línea (por ejemplo, en un gestor de contraseñas). Sin ella, los respaldos no se pueden leer. Ningún paso imprime la cadena de conexión, la clave, apodos ni filas: solo recuentos (`backup.*`, `restore.*`, `db.*`).
- **Restaurar en producción (emergencia, a mano):** bajar el artefacto `db-backup` de la pestaña Actions; `age --decrypt --identity clave.txt --output sk.dump sudoku-killer.dump.age`; crear en Neon una rama o un proyecto nuevo y `pg_restore --no-owner --no-privileges --dbname="<cadena de la base nueva>" sk.dump`; cambiar `DATABASE_URL` en Render y redesplegar. El volcado sin cifrar se borra al terminar.

## 4. Dependabot

**Decisión (v1):** solo las **alertas** de Dependabot están activas; no hay **actualizaciones automáticas** (PR con versiones nuevas). Las dependencias se actualizan a mano, con la CI completa, cuando una alerta lo pide.

- **Alternativa considerada:** activar las actualizaciones de seguridad y un `dependabot.yml` mensual y agrupado (un PR por ecosistema: npm y GitHub Actions), sin fusión automática. Costaría unos 10–20 min al mes de revisión y unos 5 min de Actions por PR.
- **Por qué no, por ahora:**
  - Las versiones nuevas pueden romper cosas fijadas a propósito: TypeScript está en 6.0.x porque `typescript-eslint` no admite la 7 (ADR 0001), y `@playwright/test` debe coincidir con el navegador instalado. Hay que ignorar esas dependencias en `dependabot.yml` o revisar cada PR.
  - Un PR automático es una vía de cambios de código de terceros; sin fusión automática, el riesgo es el de cualquier PR revisado.
- **Costo de no activarlas:** depender de las alertas y de `pnpm audit`, razonable en un proyecto pequeño, sin datos personales y con pocas dependencias de ejecución (`ws`, `pg`, `drizzle-orm`, `zod` y React).

## 5. Límites por IP (S-02, S-08)

Valores y reglas en SPEC §4.8 y R-40. Son permisivos a propósito: no deben molestar a personas reales.

| Límite | Umbral | Espera | Por qué ese valor |
|---|---|---|---|
| Joins fallidos, ráfaga | Más de 12 en 10 s | 30 s | Con un enlace caducado, 6 personas en una casa fallan y reintentan una vez: 12. Subirlo de 8 a 12 no ayuda a un bot, porque el total lo limita la ventana larga. |
| Joins fallidos, sostenido | Más de 30 en 10 min | 5 min | Tres fallos por minuto, sostenidos, ya no son un error humano. |
| `room.create`, ráfaga | Más de 6 en 10 s | 30 s | Seis personas creando sala a la vez no se bloquean. |
| `room.create`, sostenido | Más de 15 en 10 min | 5 min | Una sala se vuelve a usar con «Volver al lobby»: nadie crea 15 en 10 min. |
| Aperturas de conexión | Más de 40 en 10 s | 30 s | Una ronda de reconexión son como máximo 40, por el tope de abiertas. |

**Las reconexiones cuentan como aperturas.** El handshake no dice si lo es, y descontarlas después permitiría abusar con una ficha válida. Si ocurriera, el cliente reintenta solo y el asiento dura 120 s, más que los 30 s de espera. Los joins con ficha válida nunca cuentan ni esperan.

### Adivinar códigos

Hay 31⁶ = 887 503 681 códigos. Sin límites, una IP llega a 800 intentos/s (40 conexiones × 20 comandos/s). Con ellos, un ciclo son 31 intentos en unos 360 s (dos esperas de 30 s y una de 5 min): 7 440 intentos al día por IP.

| Escenario | Intentos por acierto | Sin límites | Con límites |
|---|---|---|---|
| 1 IP, 50 salas activas | 17,75 millones | 6,2 h | 6,5 años |
| 1 IP, 500 salas activas | 1,78 millones | 37 min | 239 días |
| 13 IP, 50 salas activas | 17,75 millones | 28 min | 184 días |
| 13 IP, 500 salas activas (peor caso de esta tabla) | 1,78 millones | menos de 3 min | **18 días** |

Con muchas más IP baja en proporción: los límites por IP no detienen a una red de bots. Un acierto solo da un asiento en una sala ajena (S-10).

### Llenar las 500 salas

Una IP crea como máximo 15 salas por ciclo (6 + 6 + 3 en unos 20 s, y la 16.ª dispara la espera de 5 min): unos 320 s por ciclo, 2,8 salas/min. Una sala vacía vive 120 s, y una conexión solo sostiene una sala.

| Forma | IP necesarias | Tiempo |
|---|---|---|
| Sosteniendo cada sala con su conexión (40 abiertas por IP) | 13 | **Unos 14 min** por IP para llegar a 38 o 39 salas, y sigue llena mientras sostenga las conexiones. |
| Sin sostenerlas, de golpe | 34 | Llega a 500 en unos 20 s, pero las salas vencen a los 120 s y la siguiente tanda tarda 320 s: el tope se llena solo a ratos. |
| Sin sostenerlas, siempre lleno | Unas 89 | 500 salas / 120 s = 250 salas/min, a 2,8 por IP. |

Sin límites, 13 IP lo lograban en segundos. Con el tope lleno, `room.create` recibe `server.unavailable` hasta que se libere una sala; las partidas en curso no se ven afectadas.

### Revisión a las 48 h con el servidor abierto

En la línea `metrics` (`docs/carga.md` §7) se revisan `joinLocked`, `createLocked`, `connectLocked` y `addressUnknown`. Los valores son una guía inicial, sin datos reales todavía.

| Campo | Normal | Indica personas reales bloqueadas | Indica un bot | Qué hacer |
|---|---|---|---|---|
| `joinLocked` | 0, con algún caso aislado | Valores bajos (1 a 5 por minuto) en varios momentos del día, con `playersConnected` > 0, o alguien avisa | Decenas o cientos por minuto, sostenidos, con `connections` creciendo | Personas: subir la ráfaga en `IP_LIMITS`. Bot: mantener. |
| `createLocked` | 0 | Cualquier valor repetido a horas de juego: nadie crea tantas salas | Sostenido, con `rooms` subiendo | Igual. |
| `connectLocked` | 0 | Mayor que 0 con `connections` / `addresses` > 10: muchas personas tras una IP compartida, como una red móvil | Mayor que 0 con pocas conexiones abiertas y aperturas continuas | Personas: subir el umbral **y** el tope de 40 abiertas. |
| `eventsDayLocked` | 0 | Cualquier valor con partidas normales: una casa no debería llegar a 60 000 comandos al día, pero esa espera dura hasta el fin de la ventana, así que se revisa de inmediato | Sostenido, con `events` alto y pocos jugadores | Personas: subir el presupuesto en `IP_LIMITS`. |
| `addressUnknown` | 0 | No aplica: nadie se bloquea, pero esas conexiones **no tienen límites** | No aplica | Revisar `TRUST_PROXY_HOPS`. |

Las redes móviles suelen compartir una IP entre muchos teléfonos. El límite de joins y el de creación solo suman fallos y salas creadas, así que el uso normal no los acerca; el de aperturas y el tope de 40 abiertas son los primeros que notarían una IP muy compartida.

## 6. Crecimiento de la base (S-09)

**Medido en producción (`db-admin status`, 2026-11-03).**

| Línea | Valor |
|---|---|
| `db.matches` | 26 |
| `db.match_events` | 3 397 |
| `db.match_events_bytes` | 1 155 072 (1,16 MB, con índices) |
| `db.total_bytes` | 12 361 728 (12,36 MB) |

Son unos **340 B por evento**, 131 eventos por partida y 44 KB por partida. Son sobre todo las partidas de la beta cerrada, no un uso público. En la base local, una partida tuvo como máximo 17 notas y 21 cambios de conexión, y el escenario realista de la prueba de carga da unas 0,07 notas/s por jugador, unas 260 por hora.

**Plan confirmado en la consola de Neon (2026-11-03):** gratuito, con 1 GB de almacenamiento, 100 horas de cómputo al mes y autoscaling hasta 2 CU. Uso actual: 36,36 MB y 0,78 CU-h. La referencia es el 70 % del plan: 700 MB **en la cifra de la consola**.

**Las dos medidas de tamaño no son la misma.** La consola marca 36,36 MB y `db.total_bytes` (`pg_database_size`), 12,36 MB. El límite del plan se mide con la cifra de la consola, y el aviso del respaldo compara `DB_ALERT_BYTES` con `db.total_bytes` de ese respaldo, nunca con la consola. Por eso el umbral baja de 700 MB a **262144000 bytes (250 MiB, unos 262 MB decimales)**.

No se ha medido cómo crece esa diferencia. Dos cuentas, solo orientativas: si se mantuviera en unos 24 MB, el aviso saltaría con unos 286 MB en la consola; si se mantuviera la proporción actual de 2,94 veces, con unos 771 MB. Las dos quedan por debajo de 1 GB. El aviso automático no reemplaza a la revisión de la consola (sección 7).

**Modelo de una partida intensa:** rellenar y corregir a mano las notas de un tablero difícil, en las dos capas, da unos 1 500 eventos por jugador. El límite físico (3 teclas/s durante 1 h) son 10 800.

**Capacidad hasta 700 MB de la consola.** Parte de los 36,36 MB de la consola: quedan 663,64 MB. No es el momento en que salta el aviso, que depende de `db.total_bytes`. Al promedio medido de 44 KB son unas 15 000 partidas; con partidas de 6 intensas (unos 400 eventos, 136 KB), unas 4 900.

**Tipos del registro.** De los 10, tienen tope natural `match.started` y `match.ended` (uno), `cell.solved` (uno por celda), `hint.used` (las pistas del equipo), `cell.mistake` (las vidas de cada jugador) y `starter.changed` (una por salida). No lo tienen, y por eso llevan tope por partida:

| Evento | Tope | Frente a lo medido |
|---|---|---|
| `note.op` y `settings.changed` | 5 000 por jugador | 3 veces la partida intensa. Hacen falta 28 min seguidos a 3 teclas/s. |
| `player.joined` | 24 por partida | 4 veces los 6 asientos. |
| `player.connection` | 500 por jugador | Más de 20 veces lo medido: 250 cortes y vueltas. |

Se eligió contar eventos por jugador frente a un tope de bytes por sala, que castigaría a todos por uno, y no se reconstruye tan fácil tras un reinicio. Los contadores salen del registro al reconstruir la partida (T-40.20); el reductor y la forma del registro no cambian.

**Presupuesto por IP.** Un tope por partida no basta: con 3 errores, un bot pierde, vuelve al lobby y empieza otra, sin perder ritmo. Por eso, los comandos de quien está en una sala (salvo `sys.ping` y `presence.select`) tienen además un presupuesto: más de 12 000 en 10 min, espera de 5 min; más de 60 000 en 24 h, espera hasta el final de la ventana. Una casa de 6 con 5 partidas intensas al día son unos 45 000.

Tiempo hasta llegar a 700 MB en la cifra de la consola, desde sus 36,36 MB, a 340 B por evento (la peor mezcla, con entradas y salidas, son unos 2 eventos por comando). Sin el presupuesto, una IP llegaría en unos 41 min (40 conexiones × 20 comandos/s × 340 B ≈ 272 KB/s).

| Escenario | Solo con notas | Peor mezcla |
|---|---|---|
| 1 IP | 20,4 MB/día: **32,5 días** | 40,8 MB/día: **16,3 días** |
| 13 IP | 265 MB/día: **2,5 días** | 530 MB/día: **1,25 días** (30 h) |

Los límites por IP no detienen a una red de bots; dan tiempo para reaccionar.

**Cómo reaccionar.** El umbral de aviso es la variable del repositorio `DB_ALERT_BYTES`, que `backup.yml` pasa al respaldo, hoy en 262144000. Sin ella, vale el valor por defecto del código, 700 000 000. El respaldo semanal escribe `backup.total_bytes` y, si llega al umbral, falla después de subir el respaldo, y GitHub avisa por correo. En la consola, al 70 % del plan (700 MB) se prepara una decisión y al 85 % se toma. El aviso es semanal y lee la medida más baja, así que puede llegar tarde en el peor caso; entre tanto se vigilan `events`, `eventsLocked` y `eventsDayLocked` en `metrics` y la consola de Neon. La salida inmediata es volver a acceso cerrado (ADR 0007). No hay purga en esta versión (ADR 0003).

## 7. Cómputo de Neon (S-08)

**Riesgo.** El plan incluye 100 horas de cómputo al mes, medidas en CU-h. Con la base despierta, eso da unas **400 h a 0,25 CU** y unas **50 h a 2 CU** (estimado). El uso actual es de 0,78 CU-h. La base se duerme a los 5 min sin actividad, pero un tráfico continuo la mantiene despierta y el autoscaling puede subir hasta 2 CU: con carga sostenida, las 100 horas podrían durar unos 2 días, y sin cómputo el juego deja de escribir hasta el mes siguiente. Los límites por IP reducen ese tráfico, no lo impiden.

**Revisión manual, la primera semana con el servidor abierto.** Cada 1 o 2 días:
1. En la consola de Neon: almacenamiento y CU-h usados.
2. `db-admin status` (`db-admin.yml`, solo recuentos): `db.total_bytes`, `db.match_events_bytes`, `db.match_events` y `db.matches`.

Se anota la diferencia entre el almacenamiento de la consola y `db.total_bytes`: si crece, se revisa `DB_ALERT_BYTES` (sección 6). Si las CU-h suben mucho más rápido que las partidas (`db.matches`), hay que mirar `metrics` en busca de tráfico anómalo.

**Opciones de emergencia.** Ninguna está implementada ni activa:
- Volver a acceso cerrado poniendo otra vez `ACCESS_KEY_HASH` (ADR 0007). No cuesta nada y corta el tráfico ajeno, pero también deja fuera a quien no tenga la clave.
- El complemento «Increase your limits» de Neon: 5 GB y 250 h por 10 USD al mes. Da margen sin cerrar el juego, pero abandona el objetivo de 0 USD (ADR 0007).
