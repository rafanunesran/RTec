import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCw, Tv, VolumeX } from "lucide-react";
import type { Channel } from "@/lib/api";
import { watchFullscreenOrientation } from "@/lib/orientation";
import { tvScreenOn } from "@/lib/tvnav";
import { boostable, boostAttached, dropBoost, setBoost, setNativeBoost } from "@/lib/boost";

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
  if (code === 401 || code === 403) return `O fornecedor recusou o acesso agora (${code}). Feche outros aparelhos usando a mesma conta e tente em 1 minuto.`;
  if (code === 503) return "O fornecedor está sem este conteúdo disponível agora (503). Tente de novo em instantes.";
  if (code === 404) return "Este conteudo nao existe mais no fornecedor (404).";
  if (code && code >= 500) return `O servidor do fornecedor esta com problema (${code}). Tente mais tarde.`;
  return `Canal fora do ar ou indisponivel no momento. (${detail}${code ? ` ${code}` : ""})`;
}

/** Descobre por que o arquivo nao abriu: pede o primeiro byte e olha a resposta do servidor. */
async function probe(src: string): Promise<number> {
  try {
    const r = await fetch(src, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(8000) });
    void r.body?.cancel();
    return r.status;
  } catch {
    return 0;
  }
}

function native(video: HTMLVideoElement, src: string, onFail: (msg: string) => void): Stop {
  let retried = false;
  const onError = async () => {
    const code = video.error?.code; // 2 = rede, 3 = decodificacao, 4 = formato/fonte
    const status = await probe(src);
    // Falha passageira do fornecedor ("stream temporarily unavailable"): tenta de novo uma vez.
    if (!retried && (status === 503 || status === 429 || status === 502 || status === 504 || code === 2)) {
      retried = true;
      const at = video.currentTime;
      setTimeout(() => {
        video.src = src;
        if (at > 0) video.currentTime = at;
        video.play().catch(() => {});
      }, 3000);
      return;
    }
    if (status === 403 && /\/api\/player\/proxy/.test(src)) onFail("O link deste vídeo expirou. Toque em Tentar novamente.");
    else if (status && (status < 200 || status >= 300)) onFail(describe(status, "arquivo"));
    else if (code === 3 || code === 4) onFail("Este aparelho não consegue tocar o formato deste vídeo (áudio ou vídeo incompatível).");
    else onFail("Não foi possível reproduzir este vídeo agora. Tente novamente.");
  };
  video.addEventListener("error", onError);
  const attemptId = String(Math.random());
  video.dataset.attempt = attemptId;
  video.src = src;
  return () => {
    video.removeEventListener("error", onError);
    // Troca rapida de canal (CH+/CH-) pode desligar uma tentativa antiga depois que a nova ja comecou
    // no mesmo <video>: so limpa se o video ainda for o desta tentativa.
    if (video.dataset.attempt !== attemptId) return;
    video.removeAttribute("src");
    video.load();
  };
}

export type BoostState = "on" | "off" | "pending" | "unavailable" | "needs-key";

type Props = {
  channel: Channel | null;
  /** Reforco de volume pedido pelo usuario. */
  boost?: boolean;
  /** Se o reforco ficou ligado, desligado ou nao pode ser usado neste video. */
  onBoost?: (s: BoostState) => void;
  /** Segundo para retomar (filmes e episodios). */
  startAt?: number;
  /** Chamado a cada poucos segundos com a posicao e a duracao. */
  onProgress?: (pos: number, dur: number) => void;
  /** Filme/episodio chegou ao fim. */
  onEnded?: () => void;
  className?: string;
};

export default function VideoPlayer({ channel, boost = false, onBoost, startAt = 0, onProgress, onEnded, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [error, setError] = useState("");
  const [tried, setTried] = useState<string[]>([]); // o que aconteceu em cada caminho tentado
  const [muted, setMuted] = useState(false); // navegador bloqueou o som no inicio
  const [attempt, setAttempt] = useState(0); // "Tentar novamente"
  // Troca o <video> por um novo: para pedir o video com CORS (reforco) ou quando o reforco ja pegou o audio
  // e o caminho seguinte e de outro dominio (ficaria mudo).
  const [el, setEl] = useState({ n: 0, cors: false });
  const carry = useRef<{ src: string; type: Channel["type"]; step: number; at: number } | null>(null);
  const corsFailed = useRef(false); // o fornecedor nao libera CORS e nao ha servidor de video: sem reforco
  const force = useRef<() => boolean>(() => false); // tenta deixar o audio legivel para o reforco

  useEffect(() => watchFullscreenOrientation(), []);

  // Callbacks em ref: trocar a funcao nao reinicia o video.
  const cb = useRef({ onProgress, onEnded, startAt });
  cb.current = { onProgress, onEnded, startAt };

  const nativeOn = useRef(false);
  useEffect(
    () => () => {
      if (nativeOn.current) void setNativeBoost(false);
    },
    [],
  );
  const boostRef = useRef({ boost, onBoost });
  boostRef.current = { boost, onBoost };
  const applyBoost = useRef(async () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    const want = boostRef.current.boost;
    // App Android: o reforco e do proprio aparelho e vale para qualquer video.
    if (!boostAttached(v) && (want || nativeOn.current) && (await setNativeBoost(want))) {
      nativeOn.current = want;
      return boostRef.current.onBoost?.(want ? "on" : "off");
    }
    if (!want && !boostAttached(v)) return boostRef.current.onBoost?.("off");
    if (want && !boostAttached(v) && !boostable(v) && force.current()) return boostRef.current.onBoost?.("pending");
    const r = await setBoost(v, want);
    if (v === videoRef.current) boostRef.current.onBoost?.(r === "blocked" ? "unavailable" : r);
  }).current;
  useEffect(() => void applyBoost(), [boost]);
  // Sem toque do usuario o navegador nao libera o audio: tenta de novo na proxima tecla/toque.
  useEffect(() => {
    const retry = () => {
      const v = videoRef.current;
      if (boostRef.current.boost && v && !nativeOn.current && !boostAttached(v) && boostable(v)) void applyBoost();
    };
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);
    return () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
    };
  }, []);
  useEffect(() => {
    const v = videoRef.current;
    return () => {
      if (v) dropBoost(v);
    };
  }, [el.n]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;
    let stop: Stop | undefined;
    let cancelled = false;
    const resume = carry.current;
    carry.current = null;
    // Caminhos, em ordem: o link do canal, pelo servidor de video, o outro formato (HLS <-> MPEG-TS) e depois
    // o mesmo titulo nas outras listas do cliente ("more"), cada uma com seus planos B.
    const paths: { src: string; type: Channel["type"]; label: string }[] = [];
    [channel, ...(channel.more || [])].forEach((s, n) => {
      const list = n ? `lista ${n + 1}, ` : "";
      if (s.src) paths.push({ src: s.src, type: s.type, label: `${list}direto` });
      if (s.fallback) paths.push({ src: s.fallback, type: s.type, label: `${list}servidor` });
      if (s.alt) paths.push({ src: s.alt, type: s.alt_type || "hls", label: `${list}formato alternativo` });
    });
    let step = resume?.step ?? 0;
    let active = { src: resume?.src ?? channel.src, type: resume?.type ?? channel.type };
    const seekTo = resume ? resume.at : cb.current.startAt;
    /** Recria o <video> e continua do mesmo caminho e do mesmo ponto. */
    const remount = (cors: boolean) => {
      carry.current = { ...active, step, at: channel!.kind === "live" ? 0 : video.currentTime };
      setEl((e) => ({ n: e.n + 1, cors }));
    };
    // Reforco pedido num video de outro dominio: pede o mesmo link com CORS. Nao passa pelo servidor de
    // video so por causa do reforco (gastaria a banda da Vercel).
    force.current = () => {
      if (cancelled || corsFailed.current || video.crossOrigin) return false;
      remount(true);
      return true;
    };
    let playedAt = 0; // quando comecou a tocar (para saber se a queda foi depois de funcionar)
    let reconnects = 0;
    let firstError = ""; // o motivo da primeira tentativa e o mais util
    const steps: string[] = [];
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
    setTried([]);
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
      // Video pedido com CORS (para o reforco) e o fornecedor recusou: volta ao link normal, sem reforco.
      if (video!.crossOrigin && !boostable(video!)) {
        corsFailed.current = true;
        remount(false);
        return;
      }
      firstError ||= msg;
      steps.push(`${paths[step]?.label ?? "direto"} (${active.type}): ${msg}`);
      // Plano B: o proximo caminho (servidor de video, outro formato, outra lista do cliente).
      if (step + 1 < paths.length) {
        step++;
        start(paths[step].src, paths[step].type);
        return;
      }
      setError(firstError || msg);
      setTried(steps.length > 1 ? steps : []);
      setState("error");
    }

    const onPlaying = () => {
      clearTimers();
      // O reforco ja pegou o audio deste <video> e agora o link e de outro dominio: ficaria mudo.
      if (boostAttached(video) && !boostable(video)) {
        remount(video.crossOrigin !== null);
        return;
      }
      playedAt ||= Date.now();
      setState("playing");
      void applyBoost();
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
      const at = seekTo;
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
    start(active.src, active.type);

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
  }, [channel, attempt, el.n]);

  return (
    <div className={className ?? "relative aspect-video w-full overflow-hidden bg-black lg:rounded-2xl lg:ring-1 lg:ring-border"}>
      <video key={el.n} ref={videoRef} crossOrigin={el.cors ? "anonymous" : undefined} className="h-full w-full" controls={!tvScreenOn()} playsInline autoPlay />
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
          {tried.length > 0 && (
            <ul className="max-w-xl space-y-0.5 text-xs text-white/50">
              {tried.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
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
