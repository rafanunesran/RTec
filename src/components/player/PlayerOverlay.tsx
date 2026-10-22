import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Cast, Heart, Pause, Play, SkipForward, Volume2, X } from "lucide-react";
import type { Channel } from "@/lib/api";
import { cn } from "@/lib/utils";
import { resumeAt, saveProgress } from "@/lib/progress";
import VideoPlayer, { type BoostState } from "@/components/VideoPlayer";
import { boostSaved, saveBoost } from "@/lib/boost";
import { restorePortrait } from "@/lib/orientation";
import { tvNavigationOn, tvScreenOn } from "@/lib/tvnav";

const fsElement = () =>
  document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;

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

/**
 * Player em tela cheia por cima do catalogo. Abre em fullscreen (no celular vira para paisagem) e,
 * em series, oferece "Proximo episodio" no fim e passa sozinho para o proximo.
 */
export default function PlayerOverlay({
  channel,
  next,
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
  const [remaining, setRemaining] = useState<number | null>(null); // segundos para acabar
  const [countdown, setCountdown] = useState<number | null>(null); // contagem para o proximo episodio
  const [chrome, setChrome] = useState(true); // barra de cima visivel
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const [boost, setBoost] = useState(boostSaved); // reforco de volume (fica lembrado no aparelho)
  const [boostState, setBoostState] = useState<BoostState>("off");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
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

  // Fullscreen ao abrir; o botao "voltar" do celular fecha o player.
  useEffect(() => {
    if (rootRef.current) enterFullscreen(rootRef.current);
    history.pushState({ rtecPlayer: true }, "");
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
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
  }, [channel.id]);

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
    hideTimer.current = setTimeout(() => setChrome(false), 3500);
  };
  useEffect(() => {
    showChrome();
    return () => clearTimeout(hideTimer.current);
  }, [channel.id]);
  // Controle remoto da TV: qualquer tecla mostra a barra de cima.
  useEffect(() => {
    const onKey = () => showChrome();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isVod = channel.kind !== "live";
  const nearEnd = isVod && next && remaining !== null && remaining < 45;
  const showNext = !!next && (!!nearEnd || countdown !== null);

  // Controle remoto: o botao "Proximo episodio" ja aparece selecionado, entao um OK basta.
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (showNext && tvNavigationOn()) nextRef.current?.focus({ preventScroll: true });
  }, [showNext]);

  // Alguns aparelhos (e o video em pedacos pelo servidor) nao avisam o fim do arquivo: perto do fim,
  // confere o video a cada segundo e comeca a contagem para o proximo episodio quando ele parar no final.
  useEffect(() => {
    if (!nearEnd || countdown !== null) return;
    const t = setInterval(() => {
      const v = rootRef.current?.querySelector("video");
      if (v && (v.ended || (v.paused && Number.isFinite(v.duration) && v.duration - v.currentTime < 1.5))) {
        saveProgress(channel, Number.MAX_SAFE_INTEGER, 1);
        setCountdown(5);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [nearEnd, countdown, channel]);

  return (
    <div ref={rootRef} data-tv-scope="50" className="fixed inset-0 z-50 flex flex-col bg-black text-white" onMouseMove={showChrome} onTouchStart={showChrome}>
      <VideoPlayer
        key={channel.id}
        channel={channel}
        boost={boost}
        onBoost={onBoost}
        startAt={isVod ? resumeAt(channel) : 0}
        onProgress={(pos, dur) => {
          saveProgress(channel, pos, dur);
          setRemaining(dur - pos);
        }}
        onEnded={() => {
          saveProgress(channel, Number.MAX_SAFE_INTEGER, 1);
          if (next) setCountdown(5);
        }}
        className="relative h-full w-full flex-1 overflow-hidden bg-black"
      />

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-3 pb-10 pt-[max(12px,env(safe-area-inset-top))] transition-opacity",
          chrome ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto flex items-center gap-2">
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
        {info && chrome && <div className="pointer-events-auto mt-2 max-w-xl">{info}</div>}
      </div>

      {notice && (
        <div className="pointer-events-none absolute left-1/2 top-[max(64px,calc(env(safe-area-inset-top)+52px))] z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-4 py-2 text-sm font-semibold ring-1 ring-white/20">
          {notice}
        </div>
      )}

      {tvScreenOn() && <TvBar root={rootRef} live={!isVod} visible={chrome} />}

      {showNext && next && (
        <div className="absolute bottom-20 right-4 z-10 flex items-center gap-2">
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
      {children}
    </div>
  );
}

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

/** TV: barra de baixo no lugar dos controles do navegador (que nao funcionam bem com o controle remoto). */
function TvBar({ root, live, visible }: { root: React.RefObject<HTMLDivElement>; live: boolean; visible: boolean }) {
  const [st, setSt] = useState({ paused: false, pos: 0, dur: 0 });
  useEffect(() => {
    const read = () => {
      const v = root.current?.querySelector("video");
      if (v) setSt({ paused: v.paused, pos: v.currentTime, dur: Number.isFinite(v.duration) ? v.duration : 0 });
    };
    read();
    const t = setInterval(read, 500);
    return () => clearInterval(t);
  }, [root]);
  const show = visible || st.paused;
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-10 pb-8 pt-20 transition-opacity",
        show ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="flex items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-black">
          {st.paused ? <Play className="h-5 w-5 fill-current" /> : <Pause className="h-5 w-5 fill-current" />}
        </span>
        {live ? (
          <span className="flex items-center gap-2 rounded-md bg-red-600 px-2.5 py-1 text-sm font-bold uppercase tracking-wider">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Ao vivo
          </span>
        ) : (
          <>
            <span className="w-20 shrink-0 text-right text-sm tabular-nums">{clock(st.pos)}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-brand" style={{ width: `${st.dur ? (st.pos / st.dur) * 100 : 0}%` }} />
            </div>
            <span className="w-20 shrink-0 text-sm tabular-nums text-white/70">{st.dur ? clock(st.dur) : "--:--"}</span>
          </>
        )}
      </div>
      <div className="mt-3 text-sm text-white/60">
        OK pausa/continua{live ? "" : " · ◀ ▶ volta/avança 10 s"} · ▲ opções · Voltar sai
      </div>
    </div>
  );
}
