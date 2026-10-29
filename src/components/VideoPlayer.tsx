import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, Radio, RotateCw, Tv, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Channel } from "@/lib/api";
import { watchFullscreenOrientation } from "@/lib/orientation";
import { tvScreenOn } from "@/lib/tvnav";
import { boostable, boostAttached, dropBoost, setBoost, setNativeBoost } from "@/lib/boost";

type Stop = () => void;

class Unsupported extends Error {}

/** <video> tocando por hls.js guarda a instancia (faixas de audio e legenda). */
export type HlsVideo = HTMLVideoElement & { hls?: import("hls.js").default };

/** Liga a fonte ao <video> com o motor certo. Chama onFail quando a reproducao quebra. */
async function attach(video: HTMLVideoElement, src: string, type: Channel["type"], onFail: (msg: string) => void): Promise<Stop> {
  if (type === "hls") {
    const { default: Hls } = await import("hls.js");
    if (Hls.isSupported()) {
      // Rede de IPTV oscila: espera mais pelos pedacos, tenta de novo varias vezes e fica alguns segundos
      // atras do "ao vivo" para ter folga. O modo de baixa latencia deixava o video sem reserva e travando.
      const load = (ttfb: number, total: number) => ({
        default: {
          maxTimeToFirstByteMs: ttfb,
          maxLoadTimeMs: total,
          timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
          errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
        },
      });
      const hls = new Hls({
        enableWorker: true,
        startFragPrefetch: true, // ja baixa o primeiro pedaco enquanto prepara o video
        lowLatencyMode: false,
        liveSyncDurationCount: 4,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30, // sem limite a memoria das TVs enche e o video comeca a engasgar
        maxBufferHole: 0.5,
        nudgeMaxRetry: 6,
        fragLoadPolicy: load(10000, 30000),
        playlistLoadPolicy: load(10000, 15000),
        manifestLoadPolicy: load(10000, 15000),
      });
      let recovers: number[] = [];
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        // Erro de decodificacao: tenta recuperar ali mesmo (ate 2 vezes por minuto) antes de reconectar.
        recovers = recovers.filter((t) => Date.now() - t < 60000);
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovers.length < 2) {
          recovers.push(Date.now());
          hls.recoverMediaError();
        } else onFail(describe(data.response?.code, data.details));
      });
      // hls.js tira o audio que o navegador nao toca: o primeiro trecho sem faixa de audio fica anotado.
      hls.on(Hls.Events.BUFFER_CODECS, (_e, d) => {
        if (d.audio || d.audiovideo) video.dataset.acodec = d.audio?.codec || "ok";
        else if (d.video) video.dataset.acodec ||= "none";
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      // Os controles do player leem daqui as faixas de audio e legenda.
      (video as HlsVideo).hls = hls;
      return () => {
        if ((video as HlsVideo).hls === hls) delete (video as HlsVideo).hls;
        hls.destroy();
      };
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) return native(video, src, onFail);
    throw new Unsupported();
  }

  if (type === "mpegts") {
    const { default: mpegts } = await import("mpegts.js");
    if (!mpegts.getFeatureList().mseLivePlayback) throw new Unsupported();
    const player = mpegts.createPlayer(
      // Link absoluto: o mpegts.js baixa dentro de um worker, que nao entende "/api/..."
      { type: "mpegts", isLive: true, url: new URL(src, location.href).href, cors: true, withCredentials: false },
      {
        enableWorker: true,
        enableStashBuffer: true, // junta um pouco de video antes de tocar: comeca mais rapido e trava menos
        stashInitialSize: 384 * 1024,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
        // Guarda so 30 s ja vistos: o padrao (3 min) enche a memoria das TVs e o video engasga.
        autoCleanupMaxBackwardDuration: 30,
        autoCleanupMinBackwardDuration: 15,
        liveBufferLatencyChasing: false, // pular para o "ao vivo" toda hora deixa o video carregando sem parar
        liveSync: false,
      },
    );
    player.on(mpegts.Events.MEDIA_INFO, (info: { audioCodec?: string }) => (video.dataset.acodec = info?.audioCodec || ""));
    player.on(mpegts.Events.ERROR, (type: string, detail: string, info?: { code?: number; msg?: string }) => {
      // Audio que o navegador nao toca (Dolby AC-3): a imagem segue sem som e o player tenta um caminho com som.
      if (/addSourceBuffer/.test(info?.msg || "") && /audio\//.test(info?.msg || "")) return;
      onFail(describe(info?.code, detail || type));
    });
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

/**
 * O video toca mas o som nao: em geral o canal manda audio Dolby (AC-3/E-AC-3), que Chrome, Android e
 * Fire Stick nao tocam no navegador (hls.js e mpegts.js descartam o audio sem avisar). So responde "sim"
 * com certeza: o motor disse que o audio ficou de fora (dataset.acodec) e o navegador confirma que video
 * esta sendo decodificado e audio nao. TVs que decodificam no hardware zeram os contadores: ali nunca acusa.
 */
function noAudio(video: HTMLVideoElement) {
  const codec = video.dataset.acodec || "";
  const dropped = codec === "none" || unsupportedAudio(codec);
  if (!dropped) return false;
  const v = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; webkitVideoDecodedByteCount?: number };
  if (typeof v.webkitAudioDecodedByteCount !== "number" || !v.webkitVideoDecodedByteCount) return false;
  return v.webkitAudioDecodedByteCount === 0;
}

/** Audio Dolby que este navegador nao toca pelo MediaSource. */
const unsupportedAudio = (codec: string) => /^[ae]c-3$/.test(codec) && !window.MediaSource?.isTypeSupported(`audio/mp4;codecs=${codec}`);

/**
 * Link de conversao de audio (Dolby -> AAC) no servidor de video separado (Oracle). Usa a mesma assinatura do
 * link do proxy dele, trocando so o caminho. O proxy da propria Vercel nao converte.
 */
function aacLink(channel: Channel) {
  for (const l of [channel.fallback, channel.src, channel.alt]) {
    if (!l) continue;
    try {
      const u = new URL(l, location.href);
      if (u.origin === location.origin || u.pathname !== "/api/player/proxy") continue;
      u.pathname = "/api/player/aac";
      return u.href;
    } catch {
      /* link invalido */
    }
  }
  return "";
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
  /** Camadas por cima do video e por baixo dos avisos (carregando, erro). */
  children?: ReactNode;
};

export default function VideoPlayer({ channel, boost = false, onBoost, startAt = 0, onProgress, onEnded, className, children }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [error, setError] = useState("");
  const [tried, setTried] = useState<string[]>([]); // o que aconteceu em cada caminho tentado
  const [muted, setMuted] = useState(false); // navegador bloqueou o som no inicio
  const [noSound, setNoSound] = useState(""); // nenhum caminho tem som que este aparelho toque
  const [hint, setHint] = useState(""); // por que esta carregando (sinal lento do fornecedor)
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
    const live = channel.kind === "live" || channel.kind === "radio";
    let stop: Stop | undefined;
    let cancelled = false;
    const resume = carry.current;
    carry.current = null;
    // Caminhos, em ordem: o link do canal, pelo servidor de video, o outro formato (HLS <-> MPEG-TS) e depois
    // o mesmo titulo nas outras listas do cliente ("more"), cada uma com seus planos B.
    const paths: { src: string; type: Channel["type"]; label: string; list: number; aac?: boolean }[] = [];
    [channel, ...(channel.more || [])].forEach((s, n) => {
      const list = n ? `lista ${n + 1}, ` : "";
      if (s.src) paths.push({ src: s.src, type: s.type, label: `${list}direto`, list: n });
      if (s.fallback) paths.push({ src: s.fallback, type: s.type, label: `${list}servidor`, list: n });
      if (s.alt) paths.push({ src: s.alt, type: s.alt_type || "hls", label: `${list}formato alternativo`, list: n });
    });
    // Por ultimo, so se tudo tocou sem som: o servidor de video converte o audio Dolby para AAC.
    const aacSrc = aacLink(channel);
    if (aacSrc) paths.push({ src: aacSrc, type: "mpegts", label: "servidor com o som convertido", list: -1, aac: true });
    let step = resume?.step ?? 0;
    let active = { src: resume?.src ?? channel.src, type: resume?.type ?? channel.type };
    const seekTo = resume ? resume.at : cb.current.startAt;
    /** Recria o <video> e continua do mesmo caminho e do mesmo ponto. */
    const remount = (cors: boolean) => {
      carry.current = { ...active, step, at: live ? 0 : video.currentTime };
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
    let audioTimer: ReturnType<typeof setTimeout> | undefined;
    // Primeiro caminho que tocou sem som: se nenhum outro tiver som, volta para ele (melhor que nada).
    let silent: { src: string; type: Channel["type"]; step: number; codec: string } | null = null;
    let silentMode = false;
    const clearTimers = () => {
      clearTimeout(watchdog);
      clearTimeout(stallTimer);
      clearTimeout(audioTimer);
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
    setNoSound("");
    setHint("");

    const start = async (src: string, type: Channel["type"]) => {
      active = { src, type };
      stop?.();
      stop = undefined;
      clearTimers();
      // Se nao comecar a tocar em alguns segundos, passa para o proximo caminho (plano B).
      watchdog = setTimeout(() => !cancelled && fail(channel!.kind === "radio" ? "A rádio não começou a tocar (sem som depois de 15 s)." : "O canal não começou a tocar (sem imagem depois de 15 s)."), live ? 15000 : 25000);
      delete video.dataset.acodec;
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
      if (live && playedAt) {
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
      next();
    }

    // Plano B: o proximo caminho (servidor de video, outro formato, outra lista do cliente).
    function next() {
      // A conversao de audio so vale a pena quando o problema e falta de som.
      while (step + 1 < paths.length && paths[step + 1].aac && !silent) step++;
      if (step + 1 < paths.length) {
        step++;
        start(paths[step].src, paths[step].type);
        return;
      }
      // Nenhum caminho com som: toca o que funcionou sem som e avisa.
      if (silent && !silentMode) {
        silentMode = true;
        step = silent.step;
        const dolby = /^[ae]c-3$/.test(silent.codec);
        setNoSound(
          dolby
            ? "Este canal está sem som neste aparelho: o fornecedor manda o áudio em Dolby (AC-3), que ele não toca. Na TV Samsung ou LG costuma ter som."
            : "Este canal está sem som neste aparelho: o áudio vem num formato que ele não toca (geralmente Dolby AC-3). Na TV Samsung ou LG costuma ter som.",
        );
        // Ja e o que esta tocando: so avisa, sem recarregar.
        if (silent.src !== active.src || video!.paused) start(silent.src, silent.type);
        return;
      }
      setError(firstError);
      setTried(steps.length > 1 ? steps : []);
      setState("error");
    }

    /** Tocou mas sem som: tenta o proximo caminho, que pode mandar audio em AAC. */
    const checkAudio = () => {
      if (cancelled || silentMode || video.paused || !noAudio(video)) return;
      const codec = video.dataset.acodec || "";
      silent ||= { ...active, step, codec };
      steps.push(`${paths[step]?.label ?? "direto"} (${active.type}): tocou sem som${codec ? ` (áudio ${codec})` : ""}`);
      firstError ||= "Este canal está sem som neste aparelho.";
      playedAt = 0; // nao e queda de sinal: o proximo caminho que falhar passa adiante, sem reconectar
      // Os outros caminhos da mesma lista mandam o mesmo audio: vai direto para a proxima lista ou a conversao.
      while (step + 1 < paths.length && paths[step + 1].list === paths[step].list) step++;
      next();
    };

    const onPlaying = () => {
      clearTimers();
      // O reforco ja pegou o audio deste <video> e agora o link e de outro dominio: ficaria mudo.
      if (boostAttached(video) && !boostable(video)) {
        remount(video.crossOrigin !== null);
        return;
      }
      playedAt ||= Date.now();
      setState("playing");
      setHint("");
      // Audio Dolby ja identificado pelo mpegts.js e que este navegador nao toca: nem espera os 5 s.
      if (!silentMode) audioTimer = setTimeout(checkAudio, unsupportedAudio(video.dataset.acodec || "") ? 1500 : 5000);
      void applyBoost();
    };
    // Ao vivo parado com video ja baixado mais a frente (buraco no sinal ou decodificador engasgado):
    // pula para o trecho seguinte em vez de ficar carregando.
    const unstick = () => {
      const b = video.buffered;
      const t = video.currentTime;
      for (let i = 0; i < b.length; i++) {
        if (b.end(i) <= t + 0.3) continue;
        const to = b.start(i) > t ? b.start(i) + 0.1 : b.end(i) - t > 3 ? t + 0.5 : 0;
        if (to && to - t < 10) {
          video.currentTime = to;
          tryPlay();
          return true;
        }
        return false;
      }
      return false;
    };
    const ahead = () => {
      const b = video.buffered;
      for (let i = 0; i < b.length; i++) if (b.start(i) <= video.currentTime + 0.3 && b.end(i) > video.currentTime) return b.end(i) - video.currentTime;
      return 0;
    };
    const onWaiting = () => {
      setState((s) => (s === "error" ? s : "loading"));
      // Ao vivo travado no "carregando" depois de ja ter tocado: tenta destravar e, se nao voltar, reconecta.
      if (live && playedAt) {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          if (cancelled || video.paused) return;
          // Sem video baixado a frente: e o sinal que nao chega (internet ou servidor da lista lento).
          if (!unstick() && ahead() < 0.5) setHint("Esperando o sinal do fornecedor. A internet ou o servidor da lista está lento agora.");
          stallTimer = setTimeout(() => !cancelled && video.paused === false && fail("O sinal travou."), 8000);
        }, 2000);
      }
    };
    const onCanPlay = () => video.paused && tryPlay();
    const onEnded = () => (live ? fail("A transmissao foi encerrada.") : cb.current.onEnded?.());
    const onMeta = () => {
      const at = seekTo;
      if (!live && at > 0 && Number.isFinite(video.duration) && at < video.duration - 10) video.currentTime = at;
    };
    const onTime = () => {
      if (live || !Number.isFinite(video.duration)) return;
      const now = Date.now();
      if (now - lastSaved < 5000) return;
      lastSaved = now;
      cb.current.onProgress?.(video.currentTime, video.duration);
    };
    const onPause = () => !live && Number.isFinite(video.duration) && cb.current.onProgress?.(video.currentTime, video.duration);
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
      <video key={el.n} ref={videoRef} crossOrigin={el.cors ? "anonymous" : undefined} className="h-full w-full" controls={!children && !tvScreenOn()} playsInline autoPlay />
      {channel?.kind === "radio" && <RadioScreen channel={channel} playing={state === "playing"} />}
      {children}
      {!channel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-glow text-muted-foreground">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-muted ring-1 ring-border">
            <Tv className="h-6 w-6" />
          </div>
          <span className="text-sm">Escolha um canal para assistir</span>
        </div>
      )}
      {channel && state === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-white/80" />
          {hint && <span className="max-w-md rounded-full bg-black/70 px-4 py-1.5 text-xs text-white/85">{hint}</span>}
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
      {noSound && state === "playing" && (
        <button
          onClick={() => setNoSound("")}
          className="absolute left-1/2 top-4 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-2xl bg-black/80 px-4 py-2 text-left text-xs text-white ring-1 ring-white/20"
        >
          <VolumeX className="h-4 w-4 shrink-0" /> {noSound}
        </button>
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

/** Radio: so tem som, entao no lugar da tela preta mostra o logo, o nome e barras de som. */
function RadioScreen({ channel, playing }: { channel: Channel; playing: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.12),transparent_60%)] p-6 text-center text-white">
      <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-3xl bg-white/10 ring-1 ring-white/20 sm:h-44 sm:w-44">
        {channel.logo ? (
          <img src={channel.logo} alt="" className="h-full w-full object-contain p-3" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <Radio className="h-14 w-14 text-white/70" />
        )}
      </div>
      <div className="max-w-[90%]">
        <div className="truncate text-xl font-bold sm:text-2xl">{channel.name}</div>
        <div className="mt-1 text-sm text-white/60">Rádio ao vivo</div>
      </div>
      <div className="flex h-8 items-end gap-1" aria-hidden>
        {[0.9, 0.5, 1, 0.7, 0.4, 0.8, 0.6].map((h, i) => (
          <span
            key={i}
            className={cn("w-1.5 rounded-full bg-primary", playing && "radio-bar")}
            style={{ height: `${h * 100}%`, animationDelay: `${i * 0.13}s`, opacity: playing ? 1 : 0.4 }}
          />
        ))}
      </div>
    </div>
  );
}
