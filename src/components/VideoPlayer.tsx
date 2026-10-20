import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Tv } from "lucide-react";
import type { Channel } from "@/lib/api";
import { watchFullscreenOrientation } from "@/lib/orientation";

type Stop = () => void;

class Unsupported extends Error {}

/** Liga a fonte ao <video> com o motor certo. Chama onFail quando a reproducao quebra. */
async function attach(video: HTMLVideoElement, src: string, type: Channel["type"], onFail: (msg: string) => void): Promise<Stop> {
  if (type === "hls") {
    const { default: Hls } = await import("hls.js");
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else onFail(describe(data.response?.code, data.details));
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) return native(video, src, onFail);
    throw new Unsupported();
  }

  if (type === "mpegts") {
    const { default: mpegts } = await import("mpegts.js");
    if (!mpegts.getFeatureList().mseLivePlayback) throw new Unsupported();
    const player = mpegts.createPlayer({ type: "mpegts", isLive: true, url: src }, { enableStashBuffer: false, liveBufferLatencyChasing: true });
    player.on(mpegts.Events.ERROR, (type: string, detail: string, info?: { code?: number; msg?: string }) => onFail(describe(info?.code, detail || type)));
    player.attachMediaElement(video);
    player.load();
    return () => {
      player.pause();
      player.unload();
      player.detachMediaElement();
      player.destroy();
    };
  }

  return native(video, src, onFail);
}

/** Mensagem de erro com o motivo real (codigo HTTP do fornecedor quando houver). */
function describe(code: number | undefined, detail: string) {
  if (code === 401 || code === 403) return `O fornecedor recusou o acesso agora (${code}). Aguarde alguns minutos e tente de novo.`;
  if (code === 404) return "Este conteudo nao existe mais no fornecedor (404).";
  if (code && code >= 500) return `O servidor do fornecedor esta com problema (${code}). Tente mais tarde.`;
  return `Canal fora do ar ou indisponivel no momento. (${detail}${code ? ` ${code}` : ""})`;
}

function native(video: HTMLVideoElement, src: string, onFail: (msg: string) => void): Stop {
  const onError = () => onFail("Nao foi possivel reproduzir este video neste aparelho.");
  video.addEventListener("error", onError);
  video.src = src;
  return () => {
    video.removeEventListener("error", onError);
    video.removeAttribute("src");
    video.load();
  };
}

type Props = {
  channel: Channel | null;
  /** Segundo para retomar (filmes e episodios). */
  startAt?: number;
  /** Chamado a cada poucos segundos com a posicao e a duracao. */
  onProgress?: (pos: number, dur: number) => void;
  /** Filme/episodio chegou ao fim. */
  onEnded?: () => void;
  className?: string;
};

export default function VideoPlayer({ channel, startAt = 0, onProgress, onEnded, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => watchFullscreenOrientation(), []);

  // Callbacks em ref: trocar a funcao nao reinicia o video.
  const cb = useRef({ onProgress, onEnded, startAt });
  cb.current = { onProgress, onEnded, startAt };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;
    let stop: Stop | undefined;
    let cancelled = false;
    let triedAlt = false;
    let active = { src: channel.src, type: channel.type };
    let playedAt = 0; // quando comecou a tocar (para saber se a queda foi depois de funcionar)
    let reconnects = 0;
    let firstError = ""; // o motivo da primeira tentativa e o mais util
    let lastSaved = 0;

    setState("loading");
    setError("");

    const start = async (src: string, type: Channel["type"]) => {
      active = { src, type };
      stop?.();
      stop = undefined;
      try {
        const s = await attach(video, src, type, fail);
        if (cancelled) return s();
        stop = s;
        video.play().catch(() => {});
      } catch (err) {
        if (err instanceof Unsupported) fail("Este aparelho não suporta o formato deste canal.");
        else fail("Falha ao iniciar o reprodutor.");
      }
    };

    // Se o formato original falhar, tenta a versao alternativa do mesmo canal (HLS <-> MPEG-TS no Xtream).
    function fail(msg: string) {
      if (cancelled) return;
      // Ao vivo que ja estava tocando e caiu (ex: limite de tempo do servidor): reconecta sozinho.
      if (channel!.kind === "live" && playedAt) {
        if (Date.now() - playedAt > 20000) reconnects = 0;
        if (reconnects < 5) {
          reconnects++;
          playedAt = 0;
          setState("loading");
          setTimeout(() => !cancelled && start(active.src, active.type), 500);
          return;
        }
      }
      firstError ||= msg;
      if (channel!.alt && !triedAlt) {
        triedAlt = true;
        start(channel!.alt, channel!.alt_type || "hls");
        return;
      }
      setError(firstError || msg);
      setState("error");
    }

    const onPlaying = () => {
      playedAt ||= Date.now();
      setState("playing");
    };
    const onWaiting = () => setState((s) => (s === "error" ? s : "loading"));
    const onEnded = () => (channel!.kind === "live" ? fail("A transmissao foi encerrada.") : cb.current.onEnded?.());
    const onMeta = () => {
      const at = cb.current.startAt;
      if (channel!.kind !== "live" && at > 0 && Number.isFinite(video.duration) && at < video.duration - 10) video.currentTime = at;
    };
    const onTime = () => {
      if (channel!.kind === "live" || !Number.isFinite(video.duration)) return;
      const now = Date.now();
      if (now - lastSaved < 5000) return;
      lastSaved = now;
      cb.current.onProgress?.(video.currentTime, video.duration);
    };
    const onPause = () => channel!.kind !== "live" && Number.isFinite(video.duration) && cb.current.onProgress?.(video.currentTime, video.duration);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("ended", onEnded);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("pause", onPause);
    start(channel.src, channel.type);

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("pause", onPause);
      onPause();
      stop?.();
    };
  }, [channel]);

  return (
    <div className={className ?? "relative aspect-video w-full overflow-hidden bg-black lg:rounded-2xl lg:ring-1 lg:ring-border"}>
      <video ref={videoRef} className="h-full w-full" controls playsInline autoPlay />
      {!channel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-glow text-muted-foreground">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-muted ring-1 ring-border">
            <Tv className="h-6 w-6" />
          </div>
          <span className="text-sm">Escolha um canal para assistir</span>
        </div>
      )}
      {channel && state === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-white/80" />
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/95 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-warning" />
          <span className="text-sm text-white/90">{error}</span>
        </div>
      )}
    </div>
  );
}
