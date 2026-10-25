# Revisión de seguridad (F11g)

Revisión del servidor de salas, del cliente y de las dependencias al cerrar F11 (2026-10-25). Política aprobada por el usuario: los hallazgos críticos, altos y medios se corrigen en F11, salvo que toquen el protocolo o lleven más de 30 minutos (entonces se pregunta); los bajos se documentan con su fase (F12 o F13).

**Severidad:** crítica (compromete datos o el servidor sin condiciones), alta (explotable desde internet con impacto serio), media (explotable con condiciones o con impacto acotado, como la disponibilidad), baja (impacto menor o que requiere otra falla), informativa (sin riesgo; se deja constancia).

## 1. Lista de revisión

| Punto | Qué se revisó | Resultado |
|---|---|---|
| Validación con Zod | Todo mensaje entrante pasa por `parseClientEnvelope` (`packages/protocol`): sobre, tipo conocido y `payload` con `z.strictObject`. JSON inválido, binario, tipo desconocido o campos de más reciben `bad_request` sin cambiar el estado; otra versión, `protocol.unsupported` y 4000. | Sin hallazgos. Pruebas: T-10.2, T-16.1, E-18, E-19 y los ejemplos válidos e inválidos de cada mensaje (SPEC §8.4). |
| Límites de velocidad | Cubetas por conexión (§4.8), aplicadas **antes** de validar; presencia y ping con cubetas propias que descartan sin aviso. | Sin hallazgos en la conexión. **S-01:** no había tope de conexiones ni de salas por instancia (corregido). La prueba de carga en estrés (20 comandos por segundo por conexión) no recibió `rate_limited`, como corresponde. |
| `maxPayload` | 16 KiB en `WebSocketServer`, cierre 1009; `perMessageDeflate` desactivado (sin bombas de compresión). | Sin hallazgos. Prueba E-18 (1009). |
| Orígenes | `Origin` obligatorio y en la lista (`ALLOWED_ORIGINS`), si no 403; solo `/ws` acepta el handshake (404 en otra ruta). | Sin hallazgos como control de navegador. **S-02:** el origen no autentica (ya registrado en F10; F12). |
| Filtración de la solución | Inspector de filtración en todas las pruebas I y E2E (claves `solution`, `token` y `tokenHash`; la solución serializada; `value` de celdas no bloqueadas); `check-dist` en cada build (T-31.2). | Sin hallazgos. T-31.1, T-31.2, T-31.3, control del inspector en E2E y el caos de F11c. |
| Filtración de fichas | Fichas de 128 bits (`node:crypto`), solo `token` en el `room.welcome` de su dueño; el arnés de pruebas falla si una ficha o un hash aparecen en el log. | Sin hallazgos. T-13.4 (I) en memoria y en la base. |
| Filtración de notas personales | Regla 4 del inspector: notas personales de un jugador en un mensaje a otro. | Sin hallazgos. R-29 y el inspector en I, E2E y caos. |
| Errores sin detalles internos | Una falla en la cola de una sala responde `server.unavailable`; el detalle y un `errorId` solo van al log, con `redact`. El HTTP responde 403, 404 o 503 sin cuerpo. Los errores de configuración nombran la variable, nunca su valor. | Sin hallazgos. |
| Fichas solo como hash | La base y el registro guardan el SHA-256 (`tokenHash`), nunca la ficha. | Sin hallazgos. T-13.4 (I). |
| Secretos | `DATABASE_URL` solo por el entorno; rol de la base sin privilegios; nada se registra en el log. | Sin hallazgos. |
| Cliente | Sin `innerHTML`, `dangerouslySetInnerHTML` ni `eval`; React escapa el texto (apodos incluidos). | **S-05** (ficha en `localStorage`, F12). |
| Dependencias | `pnpm audit` (2026-10-25). | **S-04** (esbuild en drizzle-kit, bajo). |

## 2. Hallazgos

| ID | Severidad | Hallazgo | Estado |
|---|---|---|---|
| S-01 | Media | **Sin tope de conexiones ni de salas por instancia.** Cualquiera que llegue al puerto podía abrir conexiones sin límite y crear una sala por conexión (cada sala vacía vive 120 s), hasta agotar la memoria del servidor (disponibilidad). | **Corregido en F11:** tope de 2 000 conexiones abiertas (el handshake recibe 503) y de 500 salas (`room.create` recibe `server.unavailable`, un código que ya existía: el protocolo no cambia). Valores en SPEC §4.8. Pruebas S-01 en `ws.test.ts`, con verificación negativa. Un tope **por IP** queda para F12 (detrás del proxy del hosting, la IP del cliente sale de una cabecera que hay que configurar ahí). **F12e:** 40 conexiones por IP (503), con la IP de `X-Forwarded-For` contando `TRUST_PROXY_HOPS` desde la derecha (lo que el cliente escribe a la izquierda no cuenta); `TRUST_PROXY_HOPS=1` en Render, a confirmar en F12j. Si estuviera mal, todos compartirían la IP del proxy: el tope de 40 sigue alcanzando para el grupo. **Tras el primer despliegue:** en Render, cada intento recibía 429 sin que el navegador hubiera mandado clave. Ahora solo cuenta una clave ofrecida que no vale (sin clave, siempre 4003), una IP que no se puede saber (cabecera ausente o corta, o una entrada que no es una IP) no comparte espera ni tope con nadie, y el 429 lleva `Retry-After` (T-39.7 a T-39.9). La línea `metrics` suma `accessLocked` y `addressUnknown` para confirmar `TRUST_PROXY_HOPS`. |
| S-02 | Alta en internet; hoy sin exposición | **Sin autenticación: el código de sala es la única barrera.** El `Origin` lo falsifica cualquier script. Con conexiones sin límite por IP, se pueden probar códigos (31⁶ ≈ 887 millones; con 50 salas, uno de cada 18 millones acierta) y entrar a una sala ajena. | **Corregido en F12d** (antes de exponer el juego, F12j): clave de acceso del grupo en el handshake (subprotocolo `sk.k.`), hash SHA-256 en `ACCESS_KEY_HASH` (obligatorio en producción), cierre 4003, 10 intentos por IP cada 10 min (después, 429), pantalla «Clave del grupo» y enlace de invitación `#k=` (SPEC R-39). La clave tiene 80 bits si la genera `access:key`; una propia, al menos 12 caracteres. |
| S-03 | Baja | **Apodos con caracteres invisibles o de control.** NFKC no quita los de ancho cero (U+200B) ni los de dirección (U+202E): «Ana» y «Ana​» son apodos distintos en la misma sala y se ven iguales (suplantación visual entre conocidos). | **Abierto, F13:** filtrarlos cambia la regla D2 del apodo (decisión de producto). React los muestra como texto, sin riesgo de inyección. |
| S-04 | Baja | **`pnpm audit`: esbuild ≤ 0.24.2 (GHSA-67mh-4wv8-2f99, moderada en el aviso)**, por `drizzle-kit > @esbuild-kit/core-utils`. La falla es del servidor de desarrollo de esbuild, que drizzle-kit no levanta; solo se usa en `db:generate`, en la máquina de desarrollo. | **Aceptado; revisar en F13** al actualizar drizzle-kit (un `override` podría romper `@esbuild-kit`, que está abandonado). |
| S-05 | Baja | **La ficha vive en `localStorage`**: un XSS la podría leer. Hoy no hay sumideros de HTML ni contenido de terceros. | **Corregido en F12e:** el sitio estático sirve una CSP restrictiva (`default-src 'none'`; scripts, estilos, imágenes y fuentes solo del sitio; `connect-src` solo del sitio y del servidor de salas; `frame-ancestors 'none'`, `base-uri` y `form-action` en `'none'`), HSTS (en `onrender.com`, Render la reemplaza por la suya, más estricta: diez años, `includeSubdomains` y `preload`; la prueba de humo acepta una igual o más estricta, F12j), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP y `Permissions-Policy`. Una sola fuente (`apps/web/scripts/security-headers.ts`) para `render.yaml`, `vite preview` y `smoke`; todas las E2E fallan ante una violación de la CSP, con una prueba de control (un script en línea bloqueado). Un XSS no podría leer y enviar la ficha a otro sitio. |
| S-06 | Baja | **Plazos del HTTP por defecto de Node** (60 s para las cabeceras): conexiones lentas a propósito ocupan sockets antes del handshake. El tope de S-01 acota el daño. | **Corregido en F12e:** `headersTimeout` y `requestTimeout` de 10 s (408), revisados cada segundo; no cortan un WebSocket abierto. Pruebas con verificación negativa. |
| S-07 | Informativa | Sin TLS en desarrollo (`ws://`). | **F12b:** HTTPS y WSS con el TLS de Render; el build de producción solo acepta `VITE_SERVER_URL` con `wss://`. |

## 3. Despliegue (F12)

### Retención de la base en Neon
- **Riesgo:** la [página de regiones de Neon](https://neon.com/docs/introduction/regions) (consultada el 2026-10-25) dice que los proyectos del plan gratuito con 90 días o más sin uso pueden borrarse desde el 2026-10-05. La nota está junto a las regiones de Azure retiradas y no queda claro si alcanza a AWS us-east-1, la región elegida (ADR 0007); se toma como si aplicara. Neon no define «uso»: lo más cercano es la última actividad del cómputo de cada rama ([ramas](https://neon.com/docs/manage/branches)), que se enciende con cualquier conexión ([escala a cero](https://neon.com/docs/introduction/scale-to-zero)).
- **Mitigación:** el respaldo semanal (`backup.yml`) se conecta y lee todas las tablas: cuenta como uso, igual que una partida.
- **Comprobación:** tras el primer respaldo programado, la «última actividad» de la rama principal en la consola de Neon coincide con la hora del job. Se repite una vez al mes.
- **Riesgo encadenado:** GitHub desactiva los workflows programados de un repositorio público tras 60 días sin actividad ([GitHub Docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)). Quedarían 30 días antes de los 90 de Neon; la revisión mensual lo detecta.

### Logs públicos de Actions
- **Riesgo:** el repositorio es público, y con él los logs de cada workflow. Un `pg_dump`, un error de conexión o un `set -x` pueden imprimir la cadena de conexión, una clave, un hash, apodos o filas de la base.
- **Regla:** ningún workflow imprime cadenas de conexión, claves, hashes, apodos ni contenido de la base, solo recuentos. Los pasos que tocan secretos o la base corren con `scripts/ci/quiet.ts`, que retiene la salida en memoria y solo deja pasar líneas de recuento (`clave: número`) y mensajes de la lista. El test `tests/workflow-logs.test.ts` falla si un workflow nuevo usa un secreto o la base fuera de ese envoltorio, o con `set -x`, `env`, `printenv` o `cat`.
- **Artefactos:** los artefactos de un repositorio público los descarga cualquier persona con cuenta de GitHub. Los respaldos se suben cifrados con `age`; la clave privada nunca entra al repositorio.

### Respaldos (F12i)
- **`backup.yml`** (domingos a las 03:17 de Lima y a mano): `pg_dump` de la base de Neon, restauración en un PostgreSQL 18 efímero del runner (no en un contenedor de servicio, que publicaría su log), comprobación (recuentos y arranque del servidor con la reconstrucción de las partidas) y cifrado con `age` para la clave pública `BACKUP_AGE_RECIPIENT` (variable del repositorio). La cadena de Neon lleva `sslmode=verify-full`, que node-postgres y libpq entienden igual (certificado y nombre verificados); `pg_dump` recibe además `sslrootcert=system` (libpq 16 o posterior), porque sin él buscaría un archivo de raíces que el runner no tiene (prueba `apps/server/test/pg-tools.test.ts`). Solo se sube el archivo cifrado (artefacto `db-backup`, 90 días); el volcado sin cifrar se borra del runner.
- **`restore-drill.yml`** (a mano): baja el último `db-backup`, lo descifra con `BACKUP_AGE_KEY` (secreto de Actions), lo restaura en un PostgreSQL efímero y lo comprueba de la misma forma. No toca producción. Es el criterio de F12 «restaurar un respaldo funciona».
- **`db-admin.yml`** (a mano): `status`, `migrate` (con la guarda de F12f) y `bank-load`.
- **Claves:** la privada de `age` vive en el secreto `BACKUP_AGE_KEY` y en una copia fuera de línea del usuario (por ejemplo, en un gestor de contraseñas). Sin ella, los respaldos no se pueden leer. Ningún paso imprime la cadena de conexión, la clave, apodos ni filas: solo recuentos (`backup.*`, `restore.*`, `db.*`).
- **Restaurar en producción (emergencia, a mano):** bajar el artefacto `db-backup` de la pestaña Actions; `age --decrypt --identity clave.txt --output sk.dump sudoku-killer.dump.age`; crear en Neon una rama o un proyecto nuevo y `pg_restore --no-owner --no-privileges --dbname="<cadena de la base nueva>" sk.dump`; cambiar `DATABASE_URL` en Render y redesplegar. El volcado sin cifrar se borra al terminar.

## 4. Actualizaciones de Dependabot (recomendación; no activadas)

Hoy solo están activas las **alertas** de Dependabot. Las **actualizaciones automáticas** abrirían PR con versiones nuevas.

- **Recomendación:** activar solo las **actualizaciones de seguridad** (no las de versión), y además un `dependabot.yml` **mensual** y **agrupado** (un PR por ecosistema: npm y GitHub Actions) para las versiones, sin fusión automática.
- **Costo:** unos 10–20 min al mes para revisar uno o dos PR agrupados; cada PR corre la CI completa (`check`, `test`, `build`, `e2e` y `attribution-guard`, unos 5 min de Actions). Las de seguridad llegan solo cuando hay un aviso.
- **Riesgo:**
  - Las versiones nuevas pueden romper cosas fijadas a propósito: TypeScript está en 6.0.x porque `typescript-eslint` no admite la 7 (ADR 0001), y `@playwright/test` debe coincidir con el navegador instalado. Hay que ignorar esas dependencias en `dependabot.yml` o revisar cada PR.
  - Un PR automático es una vía de cambios de código de terceros; sin fusión automática, el riesgo es el de cualquier PR revisado.
  - Los commits de Dependabot tienen su propia identidad: hay que confirmar que el job `attribution-guard` los acepta.
- **Sin activarlas**, el costo es depender de `pnpm audit` a mano o de las alertas; en un proyecto de un grupo cerrado y con pocas dependencias de ejecución (`ws`, `pg`, `drizzle-orm`, `zod` y React), también es una opción razonable hasta F13.

La decisión es del usuario.
