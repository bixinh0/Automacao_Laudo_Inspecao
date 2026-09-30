#!/usr/bin/env bash
# Testa as migrations e as regras de permissão num PostgreSQL local, simulando o Supabase.
#   PGHOST=... PGPORT=... PGUSER=... ./scripts/testar-banco.sh
# Cria (e apaga no fim) um banco temporário "laudos_teste".
set -euo pipefail
cd "$(dirname "$0")/.."
BANCO=laudos_teste
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $BANCO" -c "create database $BANCO"
trap 'psql -q -d postgres -c "drop database if exists $BANCO" >/dev/null' EXIT
rodar() { psql -v ON_ERROR_STOP=1 -q -d "$BANCO" -f "$1" > /dev/null; }
rodar supabase/testes/supabase_simulado.sql
for m in supabase/migrations/*.sql; do rodar "$m"; echo "migration ok: $(basename "$m")"; done
psql -v ON_ERROR_STOP=1 -q -d "$BANCO" -f supabase/testes/permissoes.sql 2>&1 >/dev/null | sed 's/^psql:[^ ]* NOTICE:  //'
echo "Todas as regras de permissão do banco passaram."
