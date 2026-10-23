import type { HlsVideo } from "@/components/VideoPlayer";

// Faixas de audio e legenda do video (player e controle por outro aparelho).
export type Track = { id: number; label: string; active: boolean };

const LANGS: Record<string, string> = {
  pt: "Português",
  por: "Português",
  "pt-br": "Português",
  en: "Inglês",
  eng: "Inglês",
  es: "Espanhol",
  spa: "Espanhol",
  fr: "Francês",
  fre: "Francês",
  fra: "Francês",
  it: "Italiano",
  ita: "Italiano",
  de: "Alemão",
  ger: "Alemão",
  deu: "Alemão",
  ja: "Japonês",
  jpn: "Japonês",
};
/** Nome da faixa: o do fornecedor, ou o idioma quando o nome e generico ("audio_1", "Track 2"). */
const trackName = (name: string | undefined, lang: string | undefined, i: number) => {
  const n = name?.trim();
  const l = lang && (LANGS[lang.toLowerCase()] || lang);
  if (n && !/^(audio|track|faixa|sub(title)?s?|legenda)[\s_-]*\d*$/i.test(n)) return n;
  return l || n || `Faixa ${i + 1}`;
};

type NativeAudio = { length: number; [i: number]: { label: string; language: string; enabled: boolean } };

/** Faixas de audio e legenda do video (hls.js ou o proprio navegador). */
export function readTracks(v: HTMLVideoElement): { audio: Track[]; text: Track[] } {
  const hls = (v as HlsVideo).hls;
  if (hls) {
    return {
      audio: hls.audioTracks.map((t, i) => ({ id: i, label: trackName(t.name, t.lang, i), active: i === hls.audioTrack })),
      text: hls.subtitleTracks.map((t, i) => ({ id: i, label: trackName(t.name, t.lang, i), active: i === hls.subtitleTrack && hls.subtitleDisplay })),
    };
  }
  const at = (v as HTMLVideoElement & { audioTracks?: NativeAudio }).audioTracks;
  const audio: Track[] = [];
  if (at) for (let i = 0; i < at.length; i++) audio.push({ id: i, label: trackName(at[i].label, at[i].language, i), active: at[i].enabled });
  const text: Track[] = [];
  for (let i = 0; i < v.textTracks.length; i++) {
    const t = v.textTracks[i];
    if (t.kind === "subtitles" || t.kind === "captions") text.push({ id: i, label: trackName(t.label, t.language, i), active: t.mode === "showing" });
  }
  return { audio, text };
}

export function setAudioTrack(v: HTMLVideoElement, id: number) {
  const hls = (v as HlsVideo).hls;
  if (hls) {
    hls.audioTrack = id;
    return;
  }
  const at = (v as HTMLVideoElement & { audioTracks?: NativeAudio }).audioTracks;
  if (at) for (let i = 0; i < at.length; i++) at[i].enabled = i === id;
}

/** id -1 desliga a legenda. */
export function setTextTrack(v: HTMLVideoElement, id: number) {
  const hls = (v as HlsVideo).hls;
  if (hls) {
    hls.subtitleTrack = id;
    hls.subtitleDisplay = id >= 0;
    return;
  }
  for (let i = 0; i < v.textTracks.length; i++) {
    const t = v.textTracks[i];
    if (t.kind === "subtitles" || t.kind === "captions") t.mode = i === id ? "showing" : "disabled";
  }
}
