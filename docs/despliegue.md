# Despliegue (F12)

Pasos del autor para el primer despliegue (F12j), en orden. Hosting en el ADR 0007; seguridad en `docs/seguridad.md` (S-02, §3). Nada de esto se escribe en el repositorio: los secretos van solo en los paneles.

1. **Clave del grupo y respaldos, en tu PC** (con el repositorio clonado y `pnpm install`):
   - `pnpm --filter @sudoku-killer/server access:key`: anota la clave, el enlace de invitación y el valor `sha256:…` (o `access:key --own` para elegir tu clave sin que se vea).
   - `age-keygen -o clave-respaldo.txt`: guarda el archivo fuera del repositorio (gestor de contraseñas); la línea `# public key: age1…` es la clave pública.
2. **Neon** (neon.com, entrar con GitHub, sin tarjeta): proyecto nuevo `sudoku-killer`, región **AWS US East 1 (N. Virginia)**. En «Connect», copia la cadena de conexión **directa** (sin «pooled»), tal como viene.
3. **Unir el PR** de la rama de F12 a `main` (la CI tiene que estar en verde).
4. **GitHub**, en el repositorio, Settings → Secrets and variables → Actions:
   - Secrets: `DATABASE_URL` (la cadena de Neon) y `BACKUP_AGE_KEY` (la línea `AGE-SECRET-KEY-…` de `clave-respaldo.txt`).
   - Variables: `BACKUP_AGE_RECIPIENT` (la clave pública `age1…`).
5. **Banco:** Actions → «Administración de la base» → Run workflow con `bank-load` (unos minutos). Tiene que terminar con `db.bank_inserted: 2000` y `db.puzzles_active: 2000`.
6. **Render** (render.com, entrar con GitHub, sin tarjeta): New → Blueprint → el repositorio, rama `main`. Cuando pida los valores, `DATABASE_URL` (la misma cadena de Neon) y `ACCESS_KEY_HASH` (el `sha256:…`). Si Render no pudo usar los nombres `sudoku-killer-lima` y `sudoku-killer-lima-ws`, anota los que asignó.
7. **Comprobar:** Actions → «Humo del despliegue» → Run workflow (con los nombres reales si cambiaron); después, «Respaldo de la base» y «Simulacro de restauración».
8. **Grupo:** comparte el enlace de invitación (`…/#k=…`) por un canal privado; quien lo abre ya no tiene que escribir la clave.

En la cadena de Neon, cambia `sslmode=require` por `sslmode=verify-full` (en Render y en el secreto de GitHub). `pg` 8 ya trata `require` como `verify-full` y avisa al arrancar (enlace a libpq-ssl) que en la versión 9 pasará a la semántica de libpq, que no verifica el certificado; con `verify-full` el comportamiento no cambia, el aviso desaparece y la conexión sigue verificada después. El resto de la cadena (por ejemplo, `channel_binding=require`) queda igual. No agregues `sslrootcert` a la cadena: node-postgres lo leería como la ruta de un archivo. Para `pg_dump` (libpq), que con `verify-full` busca `~/.postgresql/root.crt`, el respaldo agrega `sslrootcert=system` solo en la cadena que le pasa (`libpqUrl` en `apps/server/scripts/db/pg-tools.ts`), así usa las raíces del sistema del runner, como Node usa las suyas. El simulacro de restauración no se conecta a Neon. Después del cambio, corre «Respaldo de la base» para confirmarlo.

Lo que sigue (F12j a F12m, en otra sesión): confirmar los nombres y `TRUST_PROXY_HOPS` (la línea `metrics` del log de Render: `addresses` con dos redes distintas debe dar 2, y `addressUnknown` debe quedar en 0), la carga en el hosting y la partida real entre iPad, iPhone y PC.
