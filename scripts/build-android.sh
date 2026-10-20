#!/usr/bin/env bash
# Gera o app Android (APK) do reprodutor e coloca em public/download/rtec-tv.apk,
# para os clientes baixarem pelo proprio site (https://SEU-SITE/download/rtec-tv.apk).
#
# Requisitos: Java 21 e Android SDK (ANDROID_HOME). Variaveis:
#   APP_URL                 endereco do site na Vercel (obrigatorio), ex: https://rtec.vercel.app
#   RTEC_KEYSTORE           arquivo .jks de assinatura (guarde fora do repositorio!)
#   RTEC_KEYSTORE_PASSWORD  senha do .jks
# Use sempre o MESMO .jks: assim os clientes conseguem atualizar o app sem desinstalar.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${APP_URL:?Defina APP_URL, ex: APP_URL=https://rtec.vercel.app}"
: "${ANDROID_HOME:?Defina ANDROID_HOME (pasta do Android SDK)}"
: "${RTEC_KEYSTORE:?Defina RTEC_KEYSTORE (arquivo .jks de assinatura)}"
: "${RTEC_KEYSTORE_PASSWORD:?Defina RTEC_KEYSTORE_PASSWORD}"

npm run build
APP_URL="$APP_URL" npx cap sync android
(cd android && ./gradlew --no-daemon -q assembleRelease)

mkdir -p public/download
cp android/app/build/outputs/apk/release/app-release.apk public/download/rtec-tv.apk
echo "APK gerado: public/download/rtec-tv.apk  (app abre $APP_URL)"
