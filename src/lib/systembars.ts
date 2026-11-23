import { isNativeApp } from "./pwa";

// Barras do sistema do Android (hora/notificacoes em cima, gestos embaixo) no reprodutor do app.
// O WebView do app nao esconde as barras com a tela cheia do site, entao o app tem um plugin proprio
// (android/.../SystemBarsPlugin.java): com o player aberto o video vai de ponta a ponta, inclusive na area
// do recorte da camera, e as barras so aparecem junto com os controles. APKs antigos nao tem o plugin.
// No navegador (Chrome) a tela cheia do site ja esconde as barras.
type NativeBars = { set(o: { player: boolean; bars: boolean }): Promise<void> };
let nativePlugin: Promise<NativeBars | null> | undefined;
const native = () =>
  (nativePlugin ??= isNativeApp()
    ? import("@capacitor/core")
        .then(({ Capacitor, registerPlugin }) => (Capacitor.isPluginAvailable("SystemBars") ? registerPlugin<NativeBars>("SystemBars") : null))
        .catch(() => null)
    : Promise.resolve(null));

/** player = reprodutor aberto (video de ponta a ponta); bars = barras do sistema visiveis. */
export function setSystemBars(player: boolean, bars: boolean) {
  void native().then((p) => p?.set({ player, bars }).catch(() => {}));
}
