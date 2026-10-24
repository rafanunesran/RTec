import type { CapacitorConfig } from "@capacitor/cli";

// App Android do reprodutor: abre o site publicado (APP_URL) dentro de um WebView.
// No app o navegador nao bloqueia links http, entao o video vai direto do fornecedor para o aparelho,
// sem passar pelo servidor (sem limite de banda). O http fica liberado so para o video dos fornecedores: o site e os
// servicos de apoio sao https (android/app/src/main/res/xml/network_security_config.xml).
// Gere com:  APP_URL=https://seu-site npm run app:android
const url = process.env.APP_URL?.replace(/\/+$/, "");

const config: CapacitorConfig = {
  appId: "app.rtec.tv",
  appName: "RTec TV",
  webDir: "dist",
  server: url ? { url, cleartext: true, androidScheme: "https" } : undefined,
  android: {
    allowMixedContent: true,
    appendUserAgent: "RTecApp/1.0",
  },
};

export default config;
