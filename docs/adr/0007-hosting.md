# 0007 — Hosting: Render (servidor y web estática) y Neon (PostgreSQL)

- Estado: aceptada
- Fecha: 2026-10-25

## Contexto
F12 publica el juego para un grupo cerrado de unas 6 personas en Lima (iPad, iPhone y PC). Restricciones del autor: **0 USD** por ahora, el subdominio gratuito del proveedor, un servidor con **WebSocket persistente** (no sirve un modelo serverless sin conexiones largas) y un PostgreSQL que **no se borre**. Cada jugada espera su confirmación en la base antes de difundirse (ADR 0004), así que la distancia entre el servidor y la base pesa más que la distancia entre Lima y el servidor.

Fuentes consultadas el 2026-10-25 (resultados de búsqueda sobre las páginas oficiales; la red de la máquina de desarrollo no abre esos dominios directamente). Con * los datos que solo aparecen en fuentes de terceros.

| Opción | ¿Duerme? / despertar | WS | Horas · memoria · tráfico | ¿La base caduca o se pausa? | Respaldos | Más cerca de Lima | Tarjeta | Mantenimiento |
|---|---|---|---|---|---|---|---|---|
| **Render** (servidor y web estática) | Tras 15 min sin HTTP ni mensajes WS (cambio del 2026-02-24); ~1 min. La web estática no duerme | Sí | 750 h/mes por workspace · 512 MB y 0,1 CPU* · ~100 GB* | Su Postgres caduca a los 30 días | — | Virginia | No | Bajo |
| Koyeb | Tras 1 h; arranque en frío | Sí | 1 instancia de 512 MB y 0,1 vCPU | Base con 5 h de cómputo al mes | — | Washington | Fuentes contradictorias | Bajo |
| Fly.io | — | Sí | Solo una prueba de 2 h o 7 días* | — | — | — | Sí, al terminar la prueba* | Medio |
| Cloud Run | Escala a cero | Corta cada conexión a los 60 min | — | — | — | — | Cuenta de facturación (sin confirmar) | Medio |
| Oracle Always Free | No | Sí | Arm recortado a 2 CPU y 12 GB* | Reclama la VM ociosa 7 días (<20 %) | Por cuenta propia | Santiago o São Paulo (sin confirmar) | Sin confirmar | Alto |
| **Neon** (PostgreSQL) | Pausa a los 5 min | — | 100 CU-h por proyecto · 1 GB · 5 GB de egreso | Proyectos con 90 días sin uso (ver Consecuencias) | Historial de 6 h | São Paulo y Virginia | No | Bajo |
| Supabase | Pausa tras 7 días sin uso* | — | 500 MB · 5 GB* | Hay que reactivarla a mano | No* | São Paulo | No | Medio |
| Aiven | Puede apagar lo que no se usa (sin cifra) | — | 1 GB de RAM · 5 GB · 20 conexiones | Sin límite de tiempo | Sí | Sin confirmar | — | Bajo |

- Render: [Deploy for Free](https://render.com/docs/free), [cambio del 2026-02-24 sobre WebSocket](https://render-www.onrender.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages), [regiones](https://render.com/docs/regions), [sitios estáticos](https://render.com/docs/static-sites), [cabeceras de sitios estáticos](https://render.com/docs/static-site-headers), [Blueprint](https://render.com/docs/blueprint-spec).
- Neon: [planes](https://neon.com/docs/introduction/plans), [regiones](https://neon.com/docs/introduction/regions), [historial](https://neon.com/docs/introduction/history-window), [escala a cero](https://neon.com/docs/introduction/scale-to-zero), [ramas](https://neon.com/docs/manage/branches).
- Otros: [Koyeb](https://www.koyeb.com/docs/faqs/pricing), [Fly.io*](https://temps.sh/blog/fly-io-pricing-2026), [Cloud Run y WebSocket](https://docs.cloud.google.com/run/docs/triggering/websockets), [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm), [Supabase*](https://automationatlas.io/answers/supabase-free-tier-limits-2026/), [Aiven](https://aiven.io/docs/platform/concepts/free-plan), [GitHub: workflows programados](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).

## Decisión
- **Servidor de salas:** servicio web gratuito de Render en **Virginia**, desde `main`, con despliegue automático solo cuando pasan los checks del commit (`autoDeployTrigger: checksPass`). El ping del cliente cada 5 s lo mantiene despierto durante una partida.
- **Web:** sitio estático gratuito de Render: no duerme, sirve las cabeceras de S-05 y muestra el aviso «Despertando el servidor…» aunque el servidor esté dormido.
- **Base:** Neon gratuito en **AWS us-east-1** (Virginia, al lado del servidor), con la cadena de conexión directa.
- Todo se describe en `render.yaml` (Blueprint), sin secretos: `DATABASE_URL` y `ACCESS_KEY_HASH` se escriben en el panel (`sync: false`).
- **Respaldos propios** (el historial de Neon es de 6 h): workflow semanal y manual que vuelca la base, la restaura en un PostgreSQL efímero, la comprueba y la sube **cifrada** como artefacto (el repositorio es público).

## Alternativas consideradas
- **Fly.io y Cloud Run:** piden tarjeta; Cloud Run además corta cada WebSocket a los 60 min.
- **Oracle Always Free:** no duerme, pero reclama una VM casi ociosa (nuestro caso) y deja el sistema operativo, el TLS, PostgreSQL y los respaldos a cargo del autor.
- **Koyeb:** su base gratuita tiene 5 h de cómputo al mes, y las fuentes no coinciden sobre la tarjeta.
- **Supabase:** se pausa tras una semana sin uso y no trae respaldos en el plan gratuito.
- **Render Postgres:** caduca a los 30 días.
- **Aiven:** trae respaldos, pero no se confirmaron sus regiones ni cuánto tiempo sin uso tolera. Queda como alternativa si Neon falla.

## Consecuencias
- **Primera conexión del día:** el servidor tarda alrededor de un minuto en despertar. La web lo precalienta al abrirse (`GET /ws`; `/healthz`, que Brave bloquea por una regla de EasyPrivacy, queda para el chequeo de Render y el humo) y muestra el aviso con reintento (F12g). Un reinicio del proveedor reconstruye las partidas (ADR 0003).
- **CPU:** 0,1 CPU no permite repetir el estrés de 50 salas; la carga en el hosting se adapta a 1, 3 y 5 salas (F12k).
- **Neon y los 90 días sin uso.** La página de regiones de Neon dice que los proyectos del plan gratuito con 90 días o más sin uso pueden borrarse desde el 2026-10-05. La nota aparece junto a las regiones de Azure retiradas, y no queda claro si alcanza a las de AWS; se toma como si aplicara. Neon no define «uso»; lo más cercano es la última actividad del cómputo de cada rama (página de ramas), que se enciende con cualquier conexión de un cliente. Por eso:
  - **El respaldo semanal cuenta como uso:** se conecta a la base y lee todas las tablas, lo que enciende el cómputo, como una partida.
  - **Comprobación:** después del primer respaldo programado, la «última actividad» de la rama principal en la consola de Neon debe coincidir con la hora del job; se repite una vez al mes, junto con la revisión de que el workflow siga activo.
  - **Riesgo encadenado:** GitHub desactiva los workflows programados de un repositorio público tras 60 días sin actividad en él. Si eso pasa, quedan 30 días antes de los 90 de Neon. La revisión mensual lo detecta; reactivarlo es un botón en la pestaña Actions.
- **Despliegue desde `main`:** cada fusión que pase la CI se publica sola.
- **Pendiente para F12j:** confirmar los nombres públicos de los dos servicios (si Render agrega un sufijo, se ajustan `render.yaml` y los orígenes) y el número de proxies delante del servidor (`TRUST_PROXY_HOPS`, S-01).
