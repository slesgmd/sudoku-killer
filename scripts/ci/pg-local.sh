#!/usr/bin/env bash
# Un PostgreSQL efímero para restaurar y comprobar un respaldo: datos en un directorio
# temporal, solo en 127.0.0.1:54329, sin contraseña y con su log en un archivo que nunca se imprime
# (un contenedor de servicio de Actions publicaría su log). Corre con scripts/ci/quiet.ts.
set -euo pipefail
BIN="${PG_BIN:-/usr/lib/postgresql/18/bin}"
DIR="$(mktemp -d)"
"$BIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
"$BIN/pg_ctl" -D "$DIR/data" -l "$DIR/postgres.log" -w \
  -o "-p 54329 -k /tmp -c listen_addresses=127.0.0.1" start >/dev/null
