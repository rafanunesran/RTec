import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function registerServiceWorker() {
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
}

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** canPrompt: o navegador permite instalar com um clique (Android/Chrome/Edge). ios: precisa das instrucoes manuais. */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const installed = isStandalone() || isNativeApp();
  return {
    canPrompt: !!deferred && !installed,
    ios: isIOS() && !installed,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      force((n) => n + 1);
    },
  };
}

/** Rodando dentro do app Android do RTec (WebView com "RTecApp" no User-Agent). */
export const isNativeApp = () => /\bRTecApp\b/.test(navigator.userAgent);

export const APK_URL = "/download/rtec-tv.apk";

/** O APK so aparece para download se ja foi publicado no site. */
export function useApkAvailable() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (isNativeApp() || /Tizen|SMART-TV|Web0S|webOS/i.test(navigator.userAgent)) return;
    fetch(APK_URL, { method: "HEAD" })
      .then((r) => setOk(r.ok && Number(r.headers.get("content-length") || 0) > 500_000))
      .catch(() => {});
  }, []);
  return ok;
}
