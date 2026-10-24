#!/usr/bin/env bash
# Gera o app das TVs Samsung antigas (Smart Hub "Orsay", 2011 a 2014) em dist-orsay/.
# O app so abre a versao leve do site (APP_URL/tv-antiga.html), feita para esses navegadores antigos.
#
# Variaveis:
#   APP_URL        endereco do site na Vercel (obrigatorio), ex: https://rtec.vercel.app
#   ORSAY_VERSION  versao do app, ex: 1.0
#
# Instalacao por pendrive: copie a pasta dist-orsay/RTecTV para a raiz do pendrive, ligue na TV e
# reinicie a TV; o app aparece em Smart Hub > Mais apps (o pendrive precisa ficar ligado).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APP_URL:?Defina APP_URL, ex: APP_URL=https://rtec.vercel.app}"
case "$APP_URL" in https://*) ;; *) echo "APP_URL precisa comecar com https:// (o app nao abre o site por http)." >&2; exit 1 ;; esac
APP_URL="${APP_URL%/}"
VERSION="${ORSAY_VERSION:-1.0}"

OUT=dist-orsay/RTecTV
rm -rf dist-orsay
mkdir -p "$OUT"
for f in config.xml index.html; do
  sed -e "s#@APP_URL@#$APP_URL#g" -e "s#@VERSION@#$VERSION#g" "orsay/$f" > "$OUT/$f"
done
cp -r orsay/icon "$OUT/icon"
(cd dist-orsay && zip -qr RTecTV.zip RTecTV)
echo "App pronto em $OUT e dist-orsay/RTecTV.zip (abre $APP_URL/tv-antiga.html)."
