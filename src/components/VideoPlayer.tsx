import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCw, Tv, VolumeX } from "lucide-react";
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
    const player = mpegts.createPlayer(
      { type: "mpegts", isLive: true, url: src, cors: true, withCredentials: false },
      {
        enableWorker: true,
        enableStashBuffer: true, // junta um pouco de video antes de tocar: comeca mais rapido e trava menos
        stashInitialSize: 384 * 1024,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
        liveBufferLatencyChasing: false, // pular para o "ao vivo" toda hora deixa o video carregando sem parar
        liveSync: false,
      },
    );
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
  const [muted, setMuted] = useState(false); // navegador bloqueou o som no inicio
  const [attempt, setAttempt] = useState(0); // "Tentar novamente"

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
    let triedFallback = false;
    let active = { src: channel.src, type: channel.type };
    let playedAt = 0; // quando comecou a tocar (para saber se a queda foi depois de funcionar)
    let reconnects = 0;
    let firstError = ""; // o motivo da primeira tentativa e o mais util
    let lastSaved = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTimers = () => {
      clearTimeout(watchdog);
      clearTimeout(stallTimer);
    };
    // Toca; se o navegador bloquear o som automatico, comeca sem som e mostra o aviso.
    const tryPlay = () =>
      video.play().catch((err: DOMException) => {
        if (err?.name !== "NotAllowedError" || cancelled) return;
        video.muted = true;
        setMuted(true);
        video.play().catch(() => {});
      });

    setState("loading");
    setError("");
    setMuted(false);

    const start = async (src: string, type: Channel["type"]) => {
      active = { src, type };
      stop?.();
      stop = undefined;
      clearTimers();
      // Se nao comecar a tocar em alguns segundos, passa para o proximo caminho (plano B).
      watchdog = setTimeout(() => !cancelled && fail("O canal não começou a tocar (sem imagem depois de 15 s)."), channel!.kind === "live" ? 15000 : 25000);
      try {
        const s = await attach(video, src, type, fail);
        if (cancelled) return s();
        stop = s;
        tryPlay();
      } catch (err) {
        if (err instanceof Unsupported) fail("Este aparelho não suporta o formato deste canal.");
        else fail("Falha ao iniciar o reprodutor.");
      }
    };

    // Se o formato original falhar, tenta a versao alternativa do mesmo canal (HLS <-> MPEG-TS no Xtream).
    function fail(msg: string) {
      if (cancelled) return;
      clearTimers();
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
      // 1o plano B: o mesmo canal pelo servidor de video (quando o direto do app falha).
      if (channel!.fallback && !triedFallback) {
        triedFallback = true;
        start(channel!.fallback, channel!.type);
        return;
      }
      // 2o plano B: o outro formato do mesmo canal (HLS <-> MPEG-TS no Xtream).
      if (channel!.alt && !triedAlt) {
        triedAlt = true;
        start(channel!.alt, channel!.alt_type || "hls");
        return;
      }
      setError(firstError || msg);
      setState("error");
    }

    const onPlaying = () => {
      clearTimers();
      playedAt ||= Date.now();
      setState("playing");
    };
    const onWaiting = () => {
      setState((s) => (s === "error" ? s : "loading"));
      // Ao vivo travado no "carregando" depois de ja ter tocado: reconecta.
      if (channel!.kind === "live" && playedAt) {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => !cancelled && video.paused === false && fail("O sinal travou."), 12000);
      }
    };
    const onCanPlay = () => video.paused && tryPlay();
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
    video.addEventListener("canplay", onCanPlay);
    start(channel.src, channel.type);

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("canplay", onCanPlay);
      clearTimers();
      onPause();
      stop?.();
    };
  }, [channel, attempt]);

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
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="mt-1 flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/90"
          >
            <RotateCw className="h-4 w-4" /> Tentar novamente
          </button>
        </div>
      )}
      {muted && state === "playing" && (
        <button
          onClick={() => {
            const v = videoRef.current;
            if (v) v.muted = false;
            setMuted(false);
          }}
          className="absolute bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/20"
        >
          <VolumeX className="h-4 w-4" /> Toque para ativar o som
        </button>
      )}
    </div>
  );
}
