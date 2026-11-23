import { isNativeApp } from "./pwa";

// Atualizacao automatica do app Android (android/.../AppUpdatePlugin.java). Ao abrir o app, compara a
// versao instalada com /download/rtec-tv.json (gerado pelo scripts/build-android.sh junto com o APK).
// Se houver versao nova, baixa o APK em segundo plano e instala:
// - Android 12+ depois da primeira vez: instala sozinho, sem perguntar, quando o cliente sai do app
//   (nunca fecha o app no meio de um video);
// - primeira vez ou Android antigo: o Android mostra "Atualizar?" (no maximo uma vez por dia, e so se nao
//   houver video tocando).
// APKs antigos nao tem o plugin: precisam ser atualizados na mao uma vez.
type Info = { versionCode: number; versionName: string; silent: boolean; canInstall: boolean };
type Native = { info(): Promise<Info>; download(o: { url: string }): Promise<void>; install(): Promise<void> };

const ASKED_KEY = "rtec:update-asked";
const DAY = 24 * 60 * 60 * 1000;

const playing = () => Array.from(document.querySelectorAll("video")).some((v) => !v.paused && !v.ended);

function askedRecently() {
  try {
    return Date.now() - Number(localStorage.getItem(ASKED_KEY) || 0) < DAY;
  } catch {
    return false;
  }
}
function markAsked() {
  try {
    localStorage.setItem(ASKED_KEY, String(Date.now()));
  } catch {
    /* sem armazenamento */
  }
}

export async function checkAppUpdate() {
  if (!isNativeApp()) return;
  try {
    const { Capacitor, registerPlugin } = await import("@capacitor/core");
    if (!Capacitor.isPluginAvailable("AppUpdate")) return;
    const plugin = registerPlugin<Native>("AppUpdate");
    const [info, latest] = await Promise.all([
      plugin.info(),
      fetch(`/download/rtec-tv.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (!latest || !(Number(latest.versionCode) > info.versionCode)) return;
    if (!info.silent && askedRecently()) return;
    await plugin.download({ url: new URL(latest.apk || "/download/rtec-tv.apk", location.href).href });

    if (info.silent) {
      // Sem perguntar: instala quando o cliente sair do app (o app fecha ao atualizar).
      const onHide = () => {
        if (document.visibilityState !== "hidden") return;
        document.removeEventListener("visibilitychange", onHide);
        void plugin.install().catch(() => {});
      };
      document.addEventListener("visibilitychange", onHide);
      return;
    }
    // Primeira vez: o Android pede confirmacao. Espera o video parar para nao interromper.
    const tryAsk = () => {
      if (document.visibilityState !== "visible" || playing()) return false;
      markAsked();
      void plugin.install().catch(() => {});
      return true;
    };
    if (tryAsk()) return;
    const timer = setInterval(() => tryAsk() && clearInterval(timer), 30_000);
  } catch {
    /* sem internet ou aparelho sem suporte: tenta na proxima abertura */
  }
}
