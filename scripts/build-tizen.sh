#!/usr/bin/env bash
# Gera o app da TV Samsung (Tizen, arquivo .wgt) do reprodutor em dist-tizen/.
# O app abre o site publicado (APP_URL), como o app Android; tela, login e controle remoto vem do proprio site.
#
# Variaveis:
#   APP_URL           endereco do site na Vercel (obrigatorio), ex: https://rtec.vercel.app
#   TIZEN_PROFILE     perfil de assinatura criado no Tizen Studio (Certificate Manager). Sem ele, so monta a pasta.
#   TIZEN_PACKAGE_ID  10 letras/numeros que identificam o app (padrao RTecTvApp1). Nao mude depois de publicar.
#   TIZEN_VERSION     versao do app, ex: 1.0.0 (aumente a cada nova versao enviada a loja)
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APP_URL:?Defina APP_URL, ex: APP_URL=https://rtec.vercel.app}"
APP_URL="${APP_URL%/}"

PACKAGE_ID="${TIZEN_PACKAGE_ID:-RTecTvApp1}"
VERSION="${TIZEN_VERSION:-1.0.3}"

if ! [[ "$PACKAGE_ID" =~ ^[0-9A-Za-z]{10}$ ]]; then
  echo "TIZEN_PACKAGE_ID precisa ter exatamente 10 letras ou numeros" >&2
  exit 1
fi

OUT=dist-tizen/app
rm -rf dist-tizen
mkdir -p "$OUT"
for f in config.xml index.html; do
  sed -e "s#@APP_URL@#$APP_URL#g" -e "s#@PACKAGE_ID@#$PACKAGE_ID#g" -e "s#@VERSION@#$VERSION#g" "tizen/$f" > "$OUT/$f"
done
cp public/icons/icon-512.png "$OUT/icon.png"

if [ -z "${TIZEN_PROFILE:-}" ]; then
  echo "Pasta do app pronta em $OUT (abre $APP_URL)."
  echo "Para gerar o .wgt assinado, instale o Tizen Studio, crie o certificado Samsung e rode de novo com TIZEN_PROFILE=nome-do-perfil."
  exit 0
fi

TIZEN_CLI="${TIZEN_CLI:-$(command -v tizen || echo "$HOME/tizen-studio/tools/ide/bin/tizen")}"
[ -x "$TIZEN_CLI" ] || { echo "Nao achei o comando tizen (Tizen Studio). Defina TIZEN_CLI=/caminho/tizen-studio/tools/ide/bin/tizen" >&2; exit 1; }

"$TIZEN_CLI" package -t wgt -s "$TIZEN_PROFILE" -- "$OUT"
mv "$OUT"/*.wgt dist-tizen/rtec-tv.wgt
echo "App gerado: dist-tizen/rtec-tv.wgt  (abre $APP_URL)"
echo "Instalar na TV (modo desenvolvedor): $TIZEN_CLI install -n dist-tizen/rtec-tv.wgt -t <nome-da-TV no sdb devices>"
