import type { CapacitorConfig } from "@capacitor/cli";

// App Android do reprodutor: abre o site publicado (APP_URL) dentro de um WebView.
// No app o navegador nao bloqueia links http, entao o video vai direto do fornecedor para o aparelho,
// sem passar pelo servidor (sem limite de banda). Gere com:  APP_URL=https://seu-site npm run app:android
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
