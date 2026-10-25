import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Captions,
  Cast,
  Heart,
  ListRestart,
  ListVideo,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { Channel } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fraction, resumeAt, saveProgress, WATCHED_AT } from "@/lib/progress";
import VideoPlayer, { type BoostState } from "@/components/VideoPlayer";
import { readTracks, setAudioTrack, setTextTrack, type Track } from "@/lib/tracks";
import { boostSaved, saveBoost } from "@/lib/boost";
import { restorePortrait } from "@/lib/orientation";
import { tvNavigationOn, tvScreenOn } from "@/lib/tvnav";

const fsElement = () =>
  document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;

const canFullscreen = () =>
  !!(document.documentElement.requestFullscreen || (document.documentElement as HTMLElement & { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen);

async function enterFullscreen(el: HTMLElement) {
  const req = el.requestFullscreen?.bind(el) ?? (el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.bind(el);
  try {
    await req?.({ navigationUI: "hide" } as FullscreenOptions);
  } catch {
    /* iPhone e alguns navegadores nao deixam: o player continua ocupando a tela toda */
  }
}

function exitFullscreen() {
  if (!fsElement()) return;
  (document.exitFullscreen?.bind(document) ?? (document as Document & { webkitExitFullscreen?: () => void }).webkitExitFullscreen?.bind(document))?.();
}

/** Celular/tablet: controles grandes no meio da tela e toque duplo nas laterais para voltar/avancar. */
const touchScreen = () => !tvScreenOn() && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;


const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

type Ep = Channel & { season?: number; episode?: number };

/**
 * Player em tela cheia por cima do catalogo. Abre em fullscreen (no celular vira para paisagem), tem
 * controles proprios (pausa, voltar/avancar 10 s, barra de tempo, anterior/proximo, recomecar, lista de
 * episodios ou canais, audio e legendas) que funcionam no toque, no mouse/teclado e no controle remoto, e,
 * em series, oferece "Proximo episodio" no fim e passa sozinho para o proximo.
 */
export default function PlayerOverlay({
  channel,
  next,
  prev,
  playlist,
  onPick,
  favorite,
  onFavorite,
  onNext,
  onClose,
  info,
  onCast,
  children,
}: {
  channel: Channel;
  next?: Channel | null;
  prev?: Channel | null;
  /** Episodios da serie ou canais da lista do que esta tocando (botao EPs/Canais). */
  playlist?: Channel[] | null;
  /** Escolheu outro episodio/canal (anterior, proximo ou na lista). */
  onPick?: (c: Channel) => void;
  favorite: boolean;
  onFavorite: () => void;
  onNext: (c: Channel) => void;
  onClose: () => void;
  info?: ReactNode;
  /** Passar para outro aparelho (TV) do ponto onde esta. */
  onCast?: () => void;
  /** Janelas abertas por cima do player (ficam dentro dele para aparecer em tela cheia). */
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tv = tvScreenOn();
  const [touch] = useState(touchScreen);
  const [remaining, setRemaining] = useState<number | null>(null); // segundos para acabar
  const [countdown, setCountdown] = useState<number | null>(null); // contagem para o proximo episodio
  const [chrome, setChrome] = useState(true); // controles visiveis
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const [boost, setBoost] = useState(boostSaved); // reforco de volume (fica lembrado no aparelho)
  const [boostState, setBoostState] = useState<BoostState>("off");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
  const [panel, setPanel] = useState<"list" | "tracks" | null>(null);
  const [st, setSt] = useState({ paused: false, pos: 0, dur: 0, muted: false, volume: 1 });
  const [tracks, setTracks] = useState<{ audio: Track[]; text: Track[] }>({ audio: [], text: [] });
  const [fs, setFs] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null); // posicao sendo escolhida na barra de tempo
  const scrubTimer = useRef<ReturnType<typeof setTimeout>>();
  const playRef = useRef<HTMLButtonElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);

  const say = (msg: string) => {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3000);
  };
  const toggleBoost = () => {
    const on = !boost;
    setBoost(on);
    saveBoost(on);
    if (!on) say("Reforço de volume desligado");
  };
  const onBoost = useCallback(
    (s: BoostState) => {
      setBoostState(s);
      if (s === "on") say("Reforço de volume ligado");
      else if (s === "pending") say("Ligando o reforço de volume…");
      else if (s === "needs-key") say(tvScreenOn() ? "Aperte OK para ligar o reforço de volume" : "Toque na tela para ligar o reforço de volume");
      else if (s === "unavailable") say("Este canal não permite o reforço de volume");
    },
    [],
  );

  const video = () => rootRef.current?.querySelector("video") ?? null;
  const isVod = channel.kind !== "live" && channel.kind !== "radio";
  const canSeek = isVod && st.dur > 0;

  const togglePlay = () => {
    const v = video();
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };
  const seekTo = (t: number) => {
    const v = video();
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, t));
    setSt((s) => ({ ...s, pos: v.currentTime }));
  };
  const seekBy = (s: number) => {
    const v = video();
    if (v && isVod) {
      seekTo(v.currentTime + s);
      say(s < 0 ? `−${Math.abs(s)} s` : `+${s} s`);
    }
  };
  /** Escolhendo o ponto na barra de tempo: mostra a posicao e so pula quando o usuario para de mexer. */
  const scrubTo = (t: number, wait: number) => {
    setScrub(t);
    clearTimeout(scrubTimer.current);
    scrubTimer.current = setTimeout(() => {
      seekTo(t);
      setScrub(null);
    }, wait);
  };
  const restart = () => {
    seekTo(0);
    void video()?.play().catch(() => {});
    say("Recomeçando do início");
  };
  const toggleFullscreen = () => (fsElement() ? exitFullscreen() : rootRef.current && enterFullscreen(rootRef.current));
  const toggleMute = () => {
    const v = video();
    if (v) v.muted = !v.muted;
  };
  const changeVolume = (d: number) => {
    const v = video();
    if (!v) return;
    v.muted = false;
    v.volume = Math.max(0, Math.min(1, v.volume + d));
    say(`Volume ${Math.round(v.volume * 100)}%`);
  };
  const pick = (c: Channel) => {
    setPanel(null);
    onPick?.(c);
  };

  // Fullscreen ao abrir; o botao "voltar" do celular fecha o player.
  useEffect(() => {
    if (rootRef.current) enterFullscreen(rootRef.current);
    history.pushState({ rtecPlayer: true }, "");
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    const onFs = () => setFs(!!fsElement());
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      exitFullscreen();
      // Ao fechar o player, o aviso de "saiu da tela cheia" pode chegar depois: volta para retrato aqui.
      restorePortrait();
    };
  }, []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    if (history.state?.rtecPlayer) history.back();
    else onClose();
  }, [onClose]);

  useEffect(() => {
    setRemaining(null);
    setCountdown(null);
    setScrub(null);
    setSt((s) => ({ ...s, pos: 0, dur: 0 }));
  }, [channel.id]);

  // Estado do video para os controles (o <video> pode ser trocado pelo reprodutor, por isso e lido sempre).
  useEffect(() => {
    let n = 0;
    const read = () => {
      const v = video();
      if (!v) return;
      setSt((s) => {
        const next = { paused: v.paused, pos: v.currentTime, dur: Number.isFinite(v.duration) ? v.duration : 0, muted: v.muted, volume: v.volume };
        return s.paused === next.paused && Math.abs(s.pos - next.pos) < 0.2 && s.dur === next.dur && s.muted === next.muted && s.volume === next.volume ? s : next;
      });
      if (n++ % 4 === 0) {
        const t = readTracks(v);
        setTracks((old) => (JSON.stringify(old) === JSON.stringify(t) ? old : t));
      }
    };
    read();
    const t = setInterval(read, 250);
    return () => clearInterval(t);
  }, []);

  // Contagem regressiva para o proximo episodio quando o atual termina.
  useEffect(() => {
    if (countdown === null || !next) return;
    if (countdown <= 0) {
      onNext(next);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? c : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, next, onNext]);

  const showChrome = () => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), tv ? 5000 : 3500);
  };
  const hideChrome = () => {
    clearTimeout(hideTimer.current);
    setChrome(false);
  };
  useEffect(() => {
    showChrome();
    return () => clearTimeout(hideTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);
  // Pausado, com uma janela aberta ou escolhendo o ponto na barra de tempo, os controles ficam na tela.
  const shown = chrome || st.paused || panel !== null || scrub !== null;

  const nearEnd = isVod && next && remaining !== null && remaining < 45;
  const showNext = !!next && (!!nearEnd || countdown !== null);

  // Controle remoto: o botao "Proximo episodio" ja aparece selecionado, entao um OK basta.
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (showNext && tvNavigationOn()) nextRef.current?.focus({ preventScroll: true });
  }, [showNext]);

  // TV: quando os controles somem, tira a selecao deles para o OK voltar a pausar/continuar
  // (senao o OK "clicaria" um botao invisivel).
  useEffect(() => {
    if (shown || !tv) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== nextRef.current && rootRef.current?.contains(a)) a.blur();
  }, [shown, tv]);

  // Teclas: qualquer uma mostra os controles. Na TV, ▼ leva aos botoes de baixo e, na barra de tempo,
  // ◀ ▶ andam no video (segurando, anda mais rapido). No computador, atalhos como no YouTube.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    showChrome();
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    const k = e.key;
    const left = k === "ArrowLeft" || k === "Left" || e.keyCode === 37;
    const right = k === "ArrowRight" || k === "Right" || e.keyCode === 39;
    const down = k === "ArrowDown" || k === "Down" || e.keyCode === 40;
    const up = k === "ArrowUp" || k === "Up" || e.keyCode === 38;

    if (panel) {
      if (k === "Escape") {
        e.preventDefault();
        setPanel(null);
      }
      return;
    }
    // Barra de tempo selecionada: ◀ ▶ escolhem o ponto (10 s por toque, mais rapido segurando).
    if (target === seekRef.current && (left || right) && canSeek) {
      e.preventDefault();
      const step = e.repeat ? Math.max(30, Math.round(st.dur / 100)) : 10;
      const base = scrub ?? video()?.currentTime ?? 0;
      scrubTo(Math.max(0, Math.min(st.dur - 1, base + (right ? step : -step))), 600);
      return;
    }
    if (tvNavigationOn()) {
      const inside = !!target && target !== document.body && !!rootRef.current?.contains(target);
      if (tv && down && !inside) {
        e.preventDefault();
        (playRef.current ?? seekRef.current)?.focus({ preventScroll: true });
      }
      return;
    }
    // Computador/celular com teclado.
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    if (k === " " || k === "k" || k === "K") {
      if (k === " " && target?.tagName === "BUTTON") return;
      e.preventDefault();
      togglePlay();
    } else if (left || right) {
      e.preventDefault();
      seekBy(right ? 10 : -10);
    } else if (up || down) {
      e.preventDefault();
      changeVolume(up ? 0.1 : -0.1);
    } else if (k === "f" || k === "F") toggleFullscreen();
    else if (k === "m" || k === "M") toggleMute();
    else if (k === "N" && e.shiftKey && next) pick(next);
    else if (k === "P" && e.shiftKey && prev) pick(prev);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    // Fase de captura: roda antes da navegacao do controle remoto (lib/tvnav).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Toque na tela: mostra/esconde os controles; toque duplo nas laterais volta/avanca 10 s.
  // Mouse: clique pausa/continua, clique duplo entra/sai da tela cheia.
  const tap = useRef({ t: 0, type: "" });
  const onSurface = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tv) return;
    if (tap.current.type === "mouse") {
      togglePlay();
      showChrome();
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const side = x < 0.35 ? -1 : x > 0.65 ? 1 : 0;
    const now = Date.now();
    if (now - tap.current.t < 350 && side && isVod) {
      tap.current.t = 0;
      seekBy(side * 10);
      showChrome();
      return;
    }
    tap.current.t = now;
    if (chrome) hideChrome();
    else showChrome();
  };

  const vodLabel = channel.kind === "series" ? "episódio" : "canal";
  const prevLabel = channel.kind === "series" ? "Episódio anterior" : "Canal anterior";
  const nextLabel = channel.kind === "series" ? "Próximo episódio" : "Próximo canal";
  const listLabel = channel.kind === "series" ? "Episódios" : "Canais";
  const hasTracks = tracks.audio.length > 1 || tracks.text.length > 0;
  const pos = scrub ?? st.pos;

  const playBtn = (big?: boolean) => (
    <CtlButton
      btnRef={playRef}
      onClick={togglePlay}
      label={st.paused ? "Continuar" : "Pausar"}
      className={big ? "h-16 w-16 bg-white text-black hover:bg-white/90" : "bg-white text-black hover:bg-white/90"}
    >
      {st.paused ? <Play className={cn("fill-current", big ? "h-8 w-8" : "h-5 w-5")} /> : <Pause className={cn("fill-current", big ? "h-8 w-8" : "h-5 w-5")} />}
    </CtlButton>
  );
  const skipBtns = (big?: boolean) => {
    const size = big ? "h-12 w-12" : undefined;
    const icon = big ? "h-6 w-6" : "h-5 w-5";
    return {
      prev: prev && onPick && (
        <CtlButton onClick={() => pick(prev)} label={prevLabel} className={size}>
          <SkipBack className={cn(icon, "fill-current")} />
        </CtlButton>
      ),
      back: isVod && (
        <CtlButton onClick={() => seekBy(-10)} label="Voltar 10 segundos" className={size}>
          <TenIcon icon={RotateCcw} className={icon} />
        </CtlButton>
      ),
      fwd: isVod && (
        <CtlButton onClick={() => seekBy(10)} label="Avançar 10 segundos" className={size}>
          <TenIcon icon={RotateCw} className={icon} />
        </CtlButton>
      ),
      next: next && onPick && (
        <CtlButton onClick={() => pick(next)} label={nextLabel} className={size}>
          <SkipForward className={cn(icon, "fill-current")} />
        </CtlButton>
      ),
    };
  };
  const center = skipBtns(true);
  const bar = skipBtns();

  return (
    <div
      ref={rootRef}
      data-tv-scope="50"
      className={cn("fixed inset-0 z-50 flex flex-col bg-black text-white", !shown && !tv && "cursor-none")}
      onPointerMove={(e) => e.pointerType === "mouse" && showChrome()}
      onPointerDown={(e) => (tap.current.type = e.pointerType)}
    >
      <VideoPlayer
        key={channel.id}
        channel={channel}
        boost={boost}
        onBoost={onBoost}
        startAt={isVod ? resumeAt(channel) : 0}
        onProgress={(p, dur) => {
          saveProgress(channel, p, dur);
          setRemaining(dur - p);
        }}
        onEnded={() => {
          saveProgress(channel, Number.MAX_SAFE_INTEGER, 1);
          if (next) setCountdown(5);
        }}
        className="relative h-full w-full flex-1 overflow-hidden bg-black"
      >
        <div className="absolute inset-0" onClick={onSurface} onDoubleClick={() => tap.current.type === "mouse" && toggleFullscreen()} />
      </VideoPlayer>

      {/* Barra de cima: voltar, titulo, reforco de volume, transmitir e favorito. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-3 pb-10 pt-[max(12px,env(safe-area-inset-top))] transition-opacity",
          shown ? "opacity-100" : "opacity-0",
        )}
      >
        <div className={cn("flex items-center gap-2", shown && "pointer-events-auto")}>
          <button onClick={close} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Voltar">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold sm:text-base">{channel.name}</div>
            {channel.group && <div className="truncate text-xs text-white/70">{channel.group}</div>}
          </div>
          <button
            onClick={toggleBoost}
            className={cn(
              "flex h-10 items-center gap-1 rounded-full px-3 text-xs font-bold",
              boost ? (boostState === "unavailable" ? "bg-white/25 text-white/70" : "bg-brand text-white") : "bg-white/10 hover:bg-white/20",
            )}
            aria-label="Reforço de volume"
            aria-pressed={boost}
            title="Reforço de volume"
          >
            <Volume2 className="h-5 w-5" />
            <span>{boost ? "+ ligado" : "+"}</span>
          </button>
          {onCast && (
            <button onClick={onCast} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Tocar em outro aparelho" title="Tocar em outro aparelho">
              <Cast className="h-5 w-5" />
            </button>
          )}
          <button onClick={onFavorite} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Favorito">
            <Heart className={cn("h-5 w-5", favorite && "fill-red-500 text-red-500")} />
          </button>
        </div>
        {info && shown && <div className="pointer-events-auto mt-2 max-w-xl">{info}</div>}
      </div>

      {notice && (
        <div className="pointer-events-none absolute left-1/2 top-[max(64px,calc(env(safe-area-inset-top)+52px))] z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-4 py-2 text-sm font-semibold ring-1 ring-white/20">
          {notice}
        </div>
      )}

      {/* Celular: controles grandes no meio da tela. */}
      {touch && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center gap-5 transition-opacity sm:gap-8",
            shown ? "opacity-100" : "opacity-0",
          )}
        >
          <div className={cn("flex items-center gap-5 sm:gap-8", shown && "pointer-events-auto")}>
            {center.prev}
            {center.back}
            {playBtn(true)}
            {center.fwd}
            {center.next}
          </div>
        </div>
      )}

      {/* Barra de baixo: tempo e controles. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-16 transition-opacity sm:px-5",
          tv && "px-10 pb-8",
          shown ? "opacity-100" : "opacity-0",
        )}
      >
        <div className={cn("space-y-2", shown && "pointer-events-auto")}>
          {isVod ? (
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-right text-xs tabular-nums sm:text-sm">{clock(pos)}</span>
              <div className="relative flex h-6 flex-1 items-center">
                <div className="pointer-events-none absolute inset-x-0 h-1.5 overflow-hidden rounded-full bg-white/25">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${st.dur ? (pos / st.dur) * 100 : 0}%` }} />
                </div>
                <input
                  ref={seekRef}
                  type="range"
                  min={0}
                  max={st.dur || 1}
                  step={1}
                  value={Math.min(pos, st.dur || 1)}
                  disabled={!canSeek}
                  onChange={(e) => scrubTo(Number(e.target.value), 300)}
                  onPointerUp={() => scrub !== null && scrubTo(scrub, 0)}
                  aria-label="Barra de tempo"
                  aria-valuetext={`${clock(pos)} de ${clock(st.dur)}`}
                  className="seek-range relative h-6 w-full cursor-pointer appearance-none bg-transparent"
                  style={{ ["--seek" as string]: `${st.dur ? (pos / st.dur) * 100 : 0}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-xs tabular-nums text-white/70 sm:text-sm">{st.dur ? `-${clock(st.dur - pos)}` : "--:--"}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {!touch && (
              <>
                {bar.prev}
                {bar.back}
                {playBtn()}
                {bar.fwd}
                {bar.next}
              </>
            )}
            {!isVod && (
              <span className="ml-1 flex items-center gap-2 rounded-md bg-red-600 px-2.5 py-1 text-xs font-bold uppercase tracking-wider sm:text-sm">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Ao vivo
              </span>
            )}
            {isVod && (
              <CtlButton onClick={restart} label="Recomeçar do início" wide={tv || !touch}>
                <ListRestart className="h-5 w-5" />
                {(tv || !touch) && <span className="hidden text-sm font-semibold md:inline">Recomeçar</span>}
              </CtlButton>
            )}
            <div className="flex-1" />
            {playlist && playlist.length > 1 && onPick && (
              <CtlButton onClick={() => setPanel("list")} label={listLabel} wide>
                <ListVideo className="h-5 w-5" />
                <span className="text-sm font-semibold">{channel.kind === "series" ? "EPs" : listLabel}</span>
              </CtlButton>
            )}
            {hasTracks && (
              <CtlButton onClick={() => setPanel("tracks")} label="Áudio e legendas">
                <Captions className="h-5 w-5" />
              </CtlButton>
            )}
            {!tv && !touch && (
              <div className="flex items-center">
                <CtlButton onClick={toggleMute} label={st.muted ? "Ativar som" : "Tirar o som"}>
                  {st.muted || st.volume === 0 ? <VolumeX className="h-5 w-5" /> : st.volume < 0.5 ? <Volume1 className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </CtlButton>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={st.muted ? 0 : st.volume}
                  onChange={(e) => {
                    const v = video();
                    if (!v) return;
                    v.volume = Number(e.target.value);
                    v.muted = v.volume === 0;
                  }}
                  aria-label="Volume"
                  className="vol-range ml-1 hidden h-6 w-20 cursor-pointer appearance-none bg-transparent sm:block"
                  style={{ ["--seek" as string]: `${(st.muted ? 0 : st.volume) * 100}%` }}
                />
              </div>
            )}
            {!tv && canFullscreen() && (
              <CtlButton onClick={toggleFullscreen} label={fs ? "Sair da tela cheia" : "Tela cheia"}>
                {fs ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </CtlButton>
            )}
          </div>
          {tv && (
            <div className="text-sm text-white/60">
              OK pausa/continua{isVod ? " · ◀ ▶ 10 s" : ""} · ▼ controles{isVod ? " (na barra de tempo, ◀ ▶ escolhem o ponto)" : ""} · CH+/CH− {vodLabel} · Voltar sai
            </div>
          )}
        </div>
      </div>

      {showNext && next && (
        <div className="absolute bottom-[9.5rem] right-4 z-10 flex items-center gap-2">
          {countdown !== null && (
            <button onClick={() => setCountdown(null)} className="grid h-11 w-11 place-items-center rounded-full bg-black/60 ring-1 ring-white/20" aria-label="Cancelar">
              <X className="h-5 w-5" />
            </button>
          )}
          <button
            ref={nextRef}
            onClick={() => onNext(next)}
            className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black shadow-lg hover:bg-white/90"
          >
            <SkipForward className="h-4 w-4" />
            {countdown !== null ? `Próximo episódio em ${countdown}s` : "Próximo episódio"}
          </button>
        </div>
      )}

      {panel === "list" && playlist && (
        <ListPanel title={listLabel} items={playlist} currentId={channel.id} series={channel.kind === "series"} onPick={pick} onClose={() => setPanel(null)} />
      )}
      {panel === "tracks" && (
        <TracksPanel
          tracks={tracks}
          onAudio={(id) => {
            const v = video();
            if (v) setAudioTrack(v, id);
            setTracks((t) => ({ ...t, audio: t.audio.map((a) => ({ ...a, active: a.id === id })) }));
          }}
          onText={(id) => {
            const v = video();
            if (v) setTextTrack(v, id);
            setTracks((t) => ({ ...t, text: t.text.map((a) => ({ ...a, active: a.id === id })) }));
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {children}
    </div>
  );
}

function CtlButton({
  onClick,
  label,
  className,
  wide,
  btnRef,
  children,
}: {
  onClick: () => void;
  label: string;
  className?: string;
  wide?: boolean;
  btnRef?: React.Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      ref={btnRef}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20",
        wide ? "px-3" : "w-10",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Seta circular com "10" no meio (voltar/avancar 10 s). */
function TenIcon({ icon: Icon, className }: { icon: typeof RotateCw; className?: string }) {
  return (
    <span className="relative grid place-items-center">
      <Icon className={className} />
      <span className="absolute text-[9px] font-bold leading-none">10</span>
    </span>
  );
}

/** Janela lateral dentro do player (fica visivel em tela cheia e prende o controle remoto). */
export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-[min(26rem,92vw)] flex-col bg-neutral-950/95 pt-[max(12px,env(safe-area-inset-top))] shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex items-center gap-2 px-4 pb-2">
          <div className="flex-1 text-base font-bold">{title}</div>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[max(12px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

/** Episodios da serie (por temporada) ou canais da lista, para trocar sem sair do player. */
export function ListPanel({
  title,
  items,
  currentId,
  series,
  onPick,
  onClose,
}: {
  title: string;
  items: Ep[];
  currentId: string;
  series: boolean;
  onPick: (c: Channel) => void;
  onClose: () => void;
}) {
  const seasons = useMemo(() => (series ? [...new Set(items.map((e) => e.season ?? 0))].sort((a, b) => a - b) : []), [items, series]);
  const [season, setSeason] = useState(() => items.find((e) => e.id === currentId)?.season ?? seasons[0] ?? 0);
  const list = useMemo(() => {
    if (series && seasons.length > 1) return items.filter((e) => (e.season ?? 0) === season);
    // Listas de canais muito grandes: mostra os vizinhos do canal atual.
    if (items.length <= 400) return items;
    const i = Math.max(0, items.findIndex((e) => e.id === currentId));
    return items.slice(Math.max(0, i - 150), i + 250);
  }, [items, series, seasons, season, currentId]);
  const currentRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = currentRef.current ?? boxRef.current?.querySelector<HTMLButtonElement>("button[data-item]");
    el?.scrollIntoView({ block: "center" });
    if (tvNavigationOn()) el?.focus({ preventScroll: true });
  }, []);

  return (
    <SidePanel title={title} onClose={onClose}>
      <div ref={boxRef}>
        {series && seasons.length > 1 && (
          <div className="scrollbar-none mb-2 flex gap-2 overflow-x-auto px-2 pb-1" role="tablist" aria-label="Temporadas">
            {seasons.map((n) => (
              <button
                key={n}
                role="tab"
                aria-selected={season === n}
                onClick={() => setSeason(n)}
                className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-semibold", season === n ? "bg-white text-black" : "bg-white/10 text-white/80 hover:bg-white/20")}
              >
                Temporada {n}
              </button>
            ))}
          </div>
        )}
        <ul className="space-y-1">
          {list.map((e) => {
            const playing = e.id === currentId;
            const f = series ? fraction(e) : 0;
            return (
              <li key={e.id}>
                <button
                  ref={playing ? currentRef : undefined}
                  data-item
                  onClick={() => (playing ? onClose() : onPick(e))}
                  className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left", playing ? "bg-white/15" : "hover:bg-white/10")}
                >
                  {series ? (
                    <span className="grid h-9 w-11 shrink-0 place-items-center rounded-md bg-white/10 text-xs font-bold tabular-nums">E{e.episode ?? "?"}</span>
                  ) : e.logo ? (
                    <img src={e.logo} alt="" loading="lazy" className="h-9 w-11 shrink-0 rounded-md bg-white/5 object-contain" />
                  ) : (
                    <span className="h-9 w-11 shrink-0 rounded-md bg-white/10" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{e.name}</span>
                    {series && (f > 0 || playing) && (
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/15">
                        <span className="block h-full bg-brand" style={{ width: `${Math.min(1, f) * 100}%` }} />
                      </span>
                    )}
                  </span>
                  {playing ? (
                    <span className="shrink-0 rounded bg-brand px-1.5 py-0.5 text-[10px] font-bold uppercase">Tocando</span>
                  ) : series && f >= WATCHED_AT ? (
                    <span className="shrink-0 text-[10px] font-bold uppercase text-white/50">Visto</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </SidePanel>
  );
}

export function TracksPanel({
  tracks,
  onAudio,
  onText,
  onClose,
}: {
  tracks: { audio: Track[]; text: Track[] };
  onAudio: (id: number) => void;
  onText: (id: number) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tvNavigationOn()) boxRef.current?.querySelector<HTMLButtonElement>("button[aria-pressed='true']")?.focus({ preventScroll: true });
  }, []);
  const row = (t: Track, onClick: () => void) => (
    <button
      key={t.id}
      aria-pressed={t.active}
      onClick={onClick}
      className={cn("flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-semibold", t.active ? "bg-white text-black" : "text-white/80 hover:bg-white/10")}
    >
      {t.label}
    </button>
  );
  return (
    <SidePanel title="Áudio e legendas" onClose={onClose}>
      <div ref={boxRef} className="space-y-4 px-2">
        {tracks.audio.length > 1 && (
          <div className="space-y-1">
            <div className="px-1 text-xs font-semibold uppercase tracking-wider text-white/50">Áudio</div>
            {tracks.audio.map((t) => row(t, () => onAudio(t.id)))}
          </div>
        )}
        {tracks.text.length > 0 && (
          <div className="space-y-1">
            <div className="px-1 text-xs font-semibold uppercase tracking-wider text-white/50">Legendas</div>
            {row({ id: -1, label: "Desligadas", active: !tracks.text.some((t) => t.active) }, () => onText(-1))}
            {tracks.text.map((t) => row(t, () => onText(t.id)))}
          </div>
        )}
      </div>
    </SidePanel>
  );
}
