import { ScreenOrientation } from "@capacitor/screen-orientation";

/** Celular (tela de toque e pequena). Tablet, TV Box e computador ficam livres para girar. */
const isPhone = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 600;

const fullscreenElement = () =>
  document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;

/** Video em tela cheia: paisagem, mesmo com a rotacao automatica bloqueada. */
export function enterLandscape() {
  if (isPhone()) ScreenOrientation.lock({ orientation: "landscape" }).catch(() => {});
}

/** Saiu da tela cheia: volta para retrato no celular (o catalogo e feito para retrato). */
export function restorePortrait() {
  if (isPhone()) ScreenOrientation.lock({ orientation: "portrait" }).catch(() => {});
  else ScreenOrientation.unlock().catch(() => {});
}

/**
 * Acompanha a tela cheia: entrar = paisagem; sair = retrato. No app Android usa o plugin nativo
 * (setRequestedOrientation); no navegador, screen.orientation.lock (o iPhone nao permite pela web).
 */
export function watchFullscreenOrientation(): () => void {
  const onChange = () => (fullscreenElement() ? enterLandscape() : restorePortrait());
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    document.removeEventListener("webkitfullscreenchange", onChange);
  };
}
