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
case "$APP_URL" in https://*) ;; *) echo "APP_URL precisa comecar com https:// (o app nao abre o site por http)." >&2; exit 1 ;; esac
: "${ANDROID_HOME:?Defina ANDROID_HOME (pasta do Android SDK)}"
: "${RTEC_KEYSTORE:?Defina RTEC_KEYSTORE (arquivo .jks de assinatura)}"
: "${RTEC_KEYSTORE_PASSWORD:?Defina RTEC_KEYSTORE_PASSWORD}"

# Cada APK novo precisa de um numero de versao maior: os apps instalados comparam com rtec-tv.json e se atualizam sozinhos.
code=$(sed -n 's/^ *versionCode \([0-9]*\).*/\1/p' android/app/build.gradle)
code=$((code + 1))
sed -i.bak "s/^\( *versionCode \)[0-9]*/\1$code/; s/^\( *versionName \)\"[^\"]*\"/\1\"1.$code\"/" android/app/build.gradle && rm -f android/app/build.gradle.bak
echo "Versao do app: $code"

npm run build
APP_URL="$APP_URL" npx cap sync android
(cd android && ./gradlew --no-daemon -q assembleRelease)

mkdir -p public/download
cp android/app/build/outputs/apk/release/app-release.apk public/download/rtec-tv.apk
printf '{"versionCode":%s,"versionName":"1.%s","apk":"/download/rtec-tv.apk"}\n' "$code" "$code" > public/download/rtec-tv.json
echo "APK gerado: public/download/rtec-tv.apk  (app abre $APP_URL), versao $code"
echo "Publique: git add android/app/build.gradle public/download && git commit -m 'App Android versao $code' && git push origin main"
