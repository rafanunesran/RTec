/**
 * Reforco de volume: passa o audio do <video> por um ganho (3x) e um compressor que segura os picos
 * para o som nao estourar. So liga quando o navegador deixa ler o audio do video: hls.js e mpegts.js
 * (endereco blob:) ou arquivo pelo proprio site (servidor de video). Num link direto de outro dominio
 * o Web Audio deixaria o video mudo, entao ali o reforco fica indisponivel e o som segue normal.
 */
const KEY = "rtec:boost";
const GAIN = 3;

export function boostSaved() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveBoost(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* navegador sem armazenamento: vale so ate fechar */
  }
}

/** O navegador deixa o Web Audio ler o audio que esta tocando agora? */
export function boostable(video: HTMLVideoElement) {
  const src = video.currentSrc || video.src;
  if (!src) return false;
  if (src.startsWith("blob:")) return true;
  try {
    return new URL(src, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

type Graph = { ctx: AudioContext; source: MediaElementAudioSourceNode; gain: GainNode; comp: DynamicsCompressorNode };
const graphs = new WeakMap<HTMLVideoElement, Graph>();
const pending = new WeakMap<HTMLVideoElement, Promise<Graph | null>>();

/** O audio deste video ja passa pelo reforco (fica assim ate o elemento sair da tela). */
export const boostAttached = (video: HTMLVideoElement) => graphs.has(video);

async function build(video: HTMLVideoElement): Promise<Graph | null> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC || !boostable(video)) return null;
  const ctx = new AC();
  if (ctx.state !== "running") await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
  // Sem um toque/tecla do usuario o navegador deixa o audio parado: ligar agora deixaria o video mudo.
  if (ctx.state !== "running") {
    void ctx.close().catch(() => {});
    return null;
  }
  try {
    const source = ctx.createMediaElementSource(video);
    const gain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const g = { ctx, source, gain, comp };
    graphs.set(video, g);
    return g;
  } catch {
    void ctx.close().catch(() => {});
    return null;
  }
}

/** Liga ou desliga o reforco. Devolve true quando ficou ligado de fato. */
export async function setBoost(video: HTMLVideoElement, on: boolean) {
  let g = graphs.get(video) ?? null;
  if (!g) {
    if (!on) return false;
    let p = pending.get(video);
    if (!p) {
      p = build(video);
      pending.set(video, p);
      void p.finally(() => pending.delete(video));
    }
    g = await p;
    if (!g) return false;
  }
  const { ctx, source, gain, comp } = g;
  source.disconnect();
  gain.disconnect();
  comp.disconnect();
  if (on) {
    gain.gain.value = GAIN;
    source.connect(gain).connect(comp).connect(ctx.destination);
  } else {
    source.connect(ctx.destination);
  }
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  return on;
}

/** Fecha o audio do reforco quando o video sai da tela (o navegador limita quantos podem existir). */
export function dropBoost(video: HTMLVideoElement) {
  const g = graphs.get(video);
  if (!g) return;
  graphs.delete(video);
  void g.ctx.close().catch(() => {});
}
