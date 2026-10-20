import { ScreenOrientation } from "@capacitor/screen-orientation";

/** Celular/tablet (tela de toque). No computador a orientacao nao muda. */
const isTouchDevice = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

const fullscreenElement = () =>
  document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;

/**
 * Em tela cheia o video vira para paisagem mesmo com a rotacao automatica bloqueada; ao sair, libera.
 * No app Android usa o plugin nativo (setRequestedOrientation); no navegador, screen.orientation.lock
 * (Chrome/Android; o iPhone nao permite travar a orientacao pela web).
 */
export function watchFullscreenOrientation(): () => void {
  const onChange = () => {
    if (!isTouchDevice()) return;
    if (fullscreenElement()) ScreenOrientation.lock({ orientation: "landscape" }).catch(() => {});
    else ScreenOrientation.unlock().catch(() => {});
  };
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    document.removeEventListener("webkitfullscreenchange", onChange);
  };
}
