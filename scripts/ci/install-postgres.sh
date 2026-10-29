#!/usr/bin/env bash
# PostgreSQL 18 (servidor y cliente, del repositorio de PGDG), unzip y age en el runner de Actions
#. El cliente 18 vuelca cualquier servidor de una versión igual o anterior (Neon). Corre con
# scripts/ci/quiet.ts: su salida no se publica.
set -euo pipefail
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsS -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" |
  sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq postgresql-18 postgresql-client-18 age unzip
