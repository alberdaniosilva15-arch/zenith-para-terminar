#!/usr/bin/env bash
# =============================================================================
# Publica o painel de administração na Vercel como admin-zenith.vercel.app
# =============================================================================
#
# Porque é que isto precisa de um ficheiro de configuração próprio:
#   O `vercel.json` da raiz fixa `buildCommand: npx vite build` e
#   `outputDirectory: dist` — é a configuração da APP PRINCIPAL. Um segundo
#   projecto no mesmo repositório leria o mesmo ficheiro e construía a app
#   errada. Por isso o painel tem o seu próprio `vercel.admin.json`, passado
#   com `--local-config`.
#
# Porque é que o `--project` é obrigatório:
#   Esta pasta já tem um `.vercel/project.json` que a liga ao projecto
#   `zenith-ride-build`. Sem `--project admin-zenith`, o deploy ia para esse
#   projecto e substituía a app principal em produção.
#
# Uso:
#   1. Cria um token em https://vercel.com/account/tokens
#   2. VERCEL_TOKEN=xxxxx bash scripts/deploy-admin.sh
#
# O resultado é https://admin-zenith.vercel.app
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${VERCEL_TOKEN:-}" ]; then
  cat <<'AVISO'
Falta o VERCEL_TOKEN.

  1. Vai a https://vercel.com/account/tokens e cria um token.
  2. Corre outra vez com o token:

     VERCEL_TOKEN=o_teu_token bash scripts/deploy-admin.sh
AVISO
  exit 1
fi

echo "== 1/2  A construir o painel (npm run build:crm) =="
npm run build:crm

if [ ! -f dist-admin/index.html ]; then
  echo "ERRO: dist-admin/index.html não existe — a construção falhou."
  exit 1
fi

echo
echo "== 2/2  A publicar em produção =="
npx vercel \
  --local-config vercel.admin.json \
  --project admin-zenith \
  --token "$VERCEL_TOKEN" \
  --yes \
  --prod

echo
echo "Pronto. Abre https://admin-zenith.vercel.app"
echo
echo "LEMBRETE: o login é com a conta Google alberdaniosilva15@gmail.com."
echo "Se o Google recusar o domínio, adiciona https://admin-zenith.vercel.app"
echo "em Vercel -> Project Settings -> Environment Variables? Não: em"
echo "Supabase -> Authentication -> URL Configuration -> Redirect URLs."
