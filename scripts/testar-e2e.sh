#!/usr/bin/env bash
# Testes de ponta a ponta: sobe o Supabase simulado e o app (build de produção) e roda
# testes/e2e/autenticacao.mjs e testes/e2e/envio.mjs no Chromium (Playwright).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
node testes/e2e/supabase-simulado.mjs > "$TMP/supabase.log" 2>&1 & PID_SUPA=$!
npm run build > "$TMP/build.log" 2>&1
SUPABASE_URL=http://localhost:54321 SUPABASE_SECRET_KEY=sb_secret_teste SUPABASE_PUBLISHABLE_KEY=sb_publishable_teste \
ALLOWED_EMAIL_DOMAIN=vanderhulst.com.br OWNER_EMAIL=luan.godoi@vanderhulst.com.br OWNER_NOME="Luan Godoi" \
OWNER_DEPARTAMENTO=QUALIDADE OWNER_SENHA_INICIAL='Van@123' LIMITE_FALHAS_POR_IP=50 PORT=3004 \
  setsid npx next start > "$TMP/app.log" 2>&1 & PID_APP=$!
# setsid + kill do grupo: encerra também o next-server filho, que senão fica preso na porta.
trap 'kill $PID_SUPA 2>/dev/null; kill -- -$PID_APP 2>/dev/null || true' EXIT
for _ in $(seq 30); do curl -s -o /dev/null localhost:3004/entrar && break; sleep 1; done
LOG_SERVIDOR="$TMP/app.log" PASTA_CAPTURAS="$TMP" node testes/e2e/autenticacao.mjs
PASTA_CAPTURAS="$TMP" node testes/e2e/envio.mjs
