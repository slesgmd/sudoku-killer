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
| S-01 | Media | **Sin tope de conexiones ni de salas por instancia.** Cualquiera que llegue al puerto podía abrir conexiones sin límite y crear una sala por conexión (cada sala vacía vive 120 s), hasta agotar la memoria del servidor (disponibilidad). | **Corregido en F11:** tope de 2 000 conexiones abiertas (el handshake recibe 503) y de 500 salas (`room.create` recibe `server.unavailable`, un código que ya existía: el protocolo no cambia). Valores en SPEC §4.8. Pruebas S-01 en `ws.test.ts`, con verificación negativa. Un tope **por IP** queda para F12 (detrás del proxy del hosting, la IP del cliente sale de una cabecera que hay que configurar ahí). |
| S-02 | Alta en internet; hoy sin exposición | **Sin autenticación: el código de sala es la única barrera.** El `Origin` lo falsifica cualquier script. Con conexiones sin límite por IP, se pueden probar códigos (31⁶ ≈ 887 millones; con 50 salas, uno de cada 18 millones acierta) y entrar a una sala ajena. | **Abierto, asignado a F12:** la clave de acceso del grupo es obligatoria antes de exponer el juego a internet (decisión del usuario en F10, en `docs/PLAN.md`, F12). Lleva más de 30 min e interfaz nueva; no se adelanta a F11. Hoy el juego solo corre en local o en la red de casa. |
| S-03 | Baja | **Apodos con caracteres invisibles o de control.** NFKC no quita los de ancho cero (U+200B) ni los de dirección (U+202E): «Ana» y «Ana​» son apodos distintos en la misma sala y se ven iguales (suplantación visual entre conocidos). | **Abierto, F13:** filtrarlos cambia la regla D2 del apodo (decisión de producto). React los muestra como texto, sin riesgo de inyección. |
| S-04 | Baja | **`pnpm audit`: esbuild ≤ 0.24.2 (GHSA-67mh-4wv8-2f99, moderada en el aviso)**, por `drizzle-kit > @esbuild-kit/core-utils`. La falla es del servidor de desarrollo de esbuild, que drizzle-kit no levanta; solo se usa en `db:generate`, en la máquina de desarrollo. | **Aceptado; revisar en F13** al actualizar drizzle-kit (un `override` podría romper `@esbuild-kit`, que está abandonado). |
| S-05 | Baja | **La ficha vive en `localStorage`**: un XSS la podría leer. Hoy no hay sumideros de HTML ni contenido de terceros. | **Abierto, F12:** cabeceras del sitio en el hosting (`Content-Security-Policy` restrictiva, `frame-ancestors 'none'`, `Referrer-Policy`). |
| S-06 | Baja | **Plazos del HTTP por defecto de Node** (60 s para las cabeceras): conexiones lentas a propósito ocupan sockets antes del handshake. El tope de S-01 acota el daño. | **Abierto, F12:** el proxy del hosting corta antes; revisar `headersTimeout` con él. |
| S-07 | Informativa | Sin TLS en desarrollo (`ws://`). | F12: HTTPS y WSS en el hosting (ya en el plan). |

## 3. Actualizaciones de Dependabot (recomendación; no activadas)

Hoy solo están activas las **alertas** de Dependabot. Las **actualizaciones automáticas** abrirían PR con versiones nuevas.

- **Recomendación:** activar solo las **actualizaciones de seguridad** (no las de versión), y además un `dependabot.yml` **mensual** y **agrupado** (un PR por ecosistema: npm y GitHub Actions) para las versiones, sin fusión automática.
- **Costo:** unos 10–20 min al mes para revisar uno o dos PR agrupados; cada PR corre la CI completa (`check`, `test`, `build`, `e2e` y `attribution-guard`, unos 5 min de Actions). Las de seguridad llegan solo cuando hay un aviso.
- **Riesgo:**
  - Las versiones nuevas pueden romper cosas fijadas a propósito: TypeScript está en 6.0.x porque `typescript-eslint` no admite la 7 (ADR 0001), y `@playwright/test` debe coincidir con el navegador instalado. Hay que ignorar esas dependencias en `dependabot.yml` o revisar cada PR.
  - Un PR automático es una vía de cambios de código de terceros; sin fusión automática, el riesgo es el de cualquier PR revisado.
  - Los commits de Dependabot tienen su propia identidad: hay que confirmar que el job `attribution-guard` los acepta.
- **Sin activarlas**, el costo es depender de `pnpm audit` a mano o de las alertas; en un proyecto de un grupo cerrado y con pocas dependencias de ejecución (`ws`, `pg`, `drizzle-orm`, `zod` y React), también es una opción razonable hasta F13.

La decisión es del usuario.
