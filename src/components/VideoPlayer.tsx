import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Tv } from "lucide-react";
import type { Channel } from "@/lib/api";

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
        else onFail("Canal fora do ar ou indisponivel no momento.");
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
    player.on(mpegts.Events.ERROR, () => onFail("Canal fora do ar ou formato nao suportado neste aparelho."));
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

export default function VideoPlayer({ channel }: { channel: Channel | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;
    let stop: Stop | undefined;
    let cancelled = false;
    let triedAlt = false;

    setState("loading");
    setError("");

    const start = async (src: string, type: Channel["type"]) => {
      stop?.();
      stop = undefined;
      try {
        const s = await attach(video, src, type, fail);
        if (cancelled) return s();
        stop = s;
        video.play().catch(() => {});
      } catch (err) {
        if (err instanceof Unsupported) fail("Este aparelho nao suporta o formato deste canal.");
        else fail("Falha ao iniciar o reprodutor.");
      }
    };

    // Se o formato original falhar, tenta a versao alternativa do mesmo canal (HLS <-> MPEG-TS no Xtream).
    function fail(msg: string) {
      if (cancelled) return;
      if (channel!.alt && !triedAlt) {
        triedAlt = true;
        start(channel!.alt, channel!.alt_type || "hls");
        return;
      }
      setError(msg);
      setState("error");
    }

    const onPlaying = () => setState("playing");
    const onWaiting = () => setState((s) => (s === "error" ? s : "loading"));
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    start(channel.src, channel.type);

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      stop?.();
    };
  }, [channel]);

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black sm:rounded-xl">
      <video ref={videoRef} className="h-full w-full" controls playsInline autoPlay />
      {!channel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Tv className="h-10 w-10" />
          <span className="text-sm">Escolha um canal para assistir</span>
        </div>
      )}
      {channel && state === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-white/80" />
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <span className="text-sm text-white/90">{error}</span>
        </div>
      )}
    </div>
  );
}
