#!/usr/bin/env bash
# Gera o app da TV LG (webOS, arquivo .ipk) do reprodutor em dist-webos/.
# Igual ao app Samsung (scripts/build-tizen.sh): o app abre o site publicado (APP_URL); tela, login e
# controle remoto vem do proprio site. Guia de instalacao: webos/INSTALAR.md
#
# Variaveis:
#   APP_URL        endereco do site na Vercel (obrigatorio), ex: https://rtec.vercel.app
#   WEBOS_APP_ID   identificador do app (padrao app.rtec.tv, o mesmo do APK). Nao mude depois de instalar.
#   WEBOS_VERSION  versao do app, ex: 1.0.0 (aumente a cada nova versao)
#
# O .ipk e montado pelo ares-package (pacote npm @webos-tools/cli, baixado pelo npx se nao estiver instalado).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APP_URL:?Defina APP_URL, ex: APP_URL=https://rtec.vercel.app}"
case "$APP_URL" in https://*) ;; *) echo "APP_URL precisa comecar com https:// (o app nao abre o site por http)." >&2; exit 1 ;; esac
APP_URL="${APP_URL%/}"

APP_ID="${WEBOS_APP_ID:-app.rtec.tv}"
VERSION="${WEBOS_VERSION:-1.0.0}"

if ! [[ "$APP_ID" =~ ^[a-z0-9.+-]+$ ]]; then
  echo "WEBOS_APP_ID so pode ter letras minusculas, numeros, ponto, + e -" >&2
  exit 1
fi

OUT=dist-webos/app
rm -rf dist-webos
mkdir -p "$OUT"
for f in appinfo.json index.html; do
  sed -e "s#@APP_URL@#$APP_URL#g" -e "s#@APP_ID@#$APP_ID#g" -e "s#@VERSION@#$VERSION#g" "webos/$f" > "$OUT/$f"
done
cp webos/icon.png webos/largeIcon.png "$OUT/"

if command -v ares-package >/dev/null 2>&1; then
  ares-package -o dist-webos "$OUT"
else
  npx --yes -p @webos-tools/cli ares-package -o dist-webos "$OUT"
fi
mv dist-webos/*.ipk dist-webos/rtec-tv-lg.ipk
echo "App gerado: dist-webos/rtec-tv-lg.ipk  (abre $APP_URL)"
echo "Instalar na TV (modo desenvolvedor): ares-install -d <nome-da-TV> dist-webos/rtec-tv-lg.ipk"
