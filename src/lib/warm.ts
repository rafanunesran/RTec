import type { Channel } from "./api";

/**
 * Adianta o que o primeiro video precisa: baixa os motores (hls.js e mpegts.js) com o aparelho parado e
 * abre a conexao com os servidores dos ultimos canais vistos. Na TV isso tira alguns segundos do primeiro play.
 */
export function warmPlayer(recent: Channel[]) {
  const idle = (fn: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
  idle(() => {
    void import("hls.js").catch(() => {});
    if (window.MediaSource) void import("mpegts.js").catch(() => {});
    const origins = new Set<string>();
    for (const c of recent) {
      for (const l of [c.src, c.fallback]) {
        try {
          const o = l && new URL(l, location.href).origin;
          if (o && o !== location.origin) origins.add(o);
        } catch {
          /* link invalido */
        }
      }
    }
    [...origins].slice(0, 4).forEach((href) => {
      if (document.head.querySelector(`link[rel="preconnect"][href="${href}"]`)) return;
      const l = document.createElement("link");
      l.rel = "preconnect";
      l.href = href;
      l.crossOrigin = "anonymous";
      document.head.appendChild(l);
    });
  });
}
