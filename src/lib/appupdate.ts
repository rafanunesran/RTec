import { useEffect, useState } from "react";
import { isNativeApp } from "./pwa";
import { tvScreenOn } from "./tvnav";

// Atualizacao do app Android. Ao abrir, compara a versao instalada com /download/rtec-tv.json (gerado pelo
// scripts/build-android.sh junto com o APK).
// - App com o atualizador (AppUpdatePlugin.java, versao 4+): baixa o APK novo em segundo plano. No Android 12+,
//   depois da primeira vez, instala sozinho quando o cliente sai do app (nunca corta um video). Na primeira vez
//   (ou Android antigo) mostra o aviso "Atualizar agora", que abre a confirmacao do Android.
// - App antigo (versao 3 ou menos, sem o atualizador): mostra o mesmo aviso; o botao baixa o APK pelo
//   gerenciador de downloads do Android (o WebView do app antigo nao baixa arquivos), e o cliente so abre e
//   toca em Atualizar.
// O aviso aparece no maximo uma vez por dia e nunca por cima de um video tocando.
type Info = { versionCode: number; versionName: string; silent: boolean; canInstall: boolean };
type Native = { info(): Promise<Info>; download(o: { url: string }): Promise<void>; install(): Promise<void> };
type Latest = { versionCode: number; versionName?: string; apk?: string; mirror?: string };

/** Ultima versao sem o atualizador: apps assim nao sabem dizer a versao, mas certamente sao <= 3. */
const OLD_MAX = 3;
/**
 * O app antigo so abre fora dele links de outro endereco (no mesmo endereco do site ele tenta abrir dentro e
 * nada acontece). O GitHub serve o mesmo APK publicado na main como download.
 */
const MIRROR = "https://raw.githubusercontent.com/rafanunesran/RTec/main/public/download/rtec-tv.apk";

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

export type AppUpdate = {
  /** "plugin" = o app instala sozinho ao tocar; "old" = baixa pelo Android e o cliente abre o arquivo. */
  mode: "plugin" | "old";
  version: string;
  /** Toque em "Atualizar agora". */
  start: () => void;
  /** Toque em "Depois". */
  later: () => void;
};

/** Aviso de versao nova do app (so dentro do app Android). */
export function useAppUpdate(): AppUpdate | null {
  const [update, setUpdate] = useState<AppUpdate | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    let stop = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let onHide: (() => void) | undefined;

    // Mostra o aviso quando nao houver video tocando.
    const offer = (u: AppUpdate) => {
      const tryShow = () => {
        if (stop || document.visibilityState !== "visible" || playing()) return false;
        setUpdate(u);
        return true;
      };
      if (!tryShow()) timer = setInterval(() => tryShow() && clearInterval(timer), 30_000);
    };

    (async () => {
      const latest: Latest | null = await fetch(`/download/rtec-tv.json?t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!latest || !Number(latest.versionCode)) return;
      const version = latest.versionName || String(latest.versionCode);
      const { Capacitor, registerPlugin } = await import("@capacitor/core");

      if (!Capacitor.isPluginAvailable("AppUpdate")) {
        // TV Box costuma nao ter navegador para baixar o arquivo: la a atualizacao continua manual.
        if (latest.versionCode <= OLD_MAX || askedRecently() || tvScreenOn()) return;
        const url = latest.mirror || MIRROR;
        offer({
          mode: "old",
          version,
          start: () => {
            markAsked();
            // Endereco de fora: o app abre no Android, que baixa o arquivo.
            window.location.href = url;
          },
          later: () => {
            markAsked();
            setUpdate(null);
          },
        });
        return;
      }

      const plugin = registerPlugin<Native>("AppUpdate");
      const info = await plugin.info();
      if (!(latest.versionCode > info.versionCode)) return;
      if (!info.silent && askedRecently()) return;
      await plugin.download({ url: new URL(latest.apk || "/download/rtec-tv.apk", location.href).href });
      if (stop) return;

      if (info.silent) {
        // Sem perguntar: instala quando o cliente sair do app (o app fecha ao atualizar).
        onHide = () => {
          if (document.visibilityState !== "hidden") return;
          document.removeEventListener("visibilitychange", onHide!);
          void plugin.install().catch(() => {});
        };
        document.addEventListener("visibilitychange", onHide);
        return;
      }
      offer({
        mode: "plugin",
        version,
        start: () => {
          markAsked();
          setUpdate(null);
          void plugin.install().catch(() => {});
        },
        later: () => {
          markAsked();
          setUpdate(null);
        },
      });
    })().catch(() => {
      /* sem internet ou aparelho sem suporte: tenta na proxima abertura */
    });

    return () => {
      stop = true;
      clearInterval(timer);
      if (onHide) document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  return update;
}
