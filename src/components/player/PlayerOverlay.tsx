import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Heart, SkipForward, X } from "lucide-react";
import type { Channel } from "@/lib/api";
import { cn } from "@/lib/utils";
import { resumeAt, saveProgress } from "@/lib/progress";
import VideoPlayer from "@/components/VideoPlayer";
import { restorePortrait } from "@/lib/orientation";

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
}: {
  channel: Channel;
  next?: Channel | null;
  favorite: boolean;
  onFavorite: () => void;
  onNext: (c: Channel) => void;
  onClose: () => void;
  info?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState<number | null>(null); // segundos para acabar
  const [countdown, setCountdown] = useState<number | null>(null); // contagem para o proximo episodio
  const [chrome, setChrome] = useState(true); // barra de cima visivel
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

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

  const isVod = channel.kind !== "live";
  const nearEnd = isVod && next && remaining !== null && remaining < 45;

  return (
    <div ref={rootRef} className="fixed inset-0 z-50 flex flex-col bg-black text-white" onMouseMove={showChrome} onTouchStart={showChrome}>
      <VideoPlayer
        key={channel.id}
        channel={channel}
        startAt={isVod ? resumeAt(channel.id) : 0}
        onProgress={(pos, dur) => {
          saveProgress(channel.id, pos, dur);
          setRemaining(dur - pos);
        }}
        onEnded={() => {
          saveProgress(channel.id, Number.MAX_SAFE_INTEGER, 1);
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
          <button onClick={onFavorite} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Favorito">
            <Heart className={cn("h-5 w-5", favorite && "fill-red-500 text-red-500")} />
          </button>
        </div>
        {info && chrome && <div className="pointer-events-auto mt-2 max-w-xl">{info}</div>}
      </div>

      {(nearEnd || countdown !== null) && next && (
        <div className="absolute bottom-20 right-4 z-10 flex items-center gap-2">
          {countdown !== null && (
            <button onClick={() => setCountdown(null)} className="grid h-11 w-11 place-items-center rounded-full bg-black/60 ring-1 ring-white/20" aria-label="Cancelar">
              <X className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => onNext(next)}
            className="flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black shadow-lg hover:bg-white/90"
          >
            <SkipForward className="h-4 w-4" />
            {countdown !== null ? `Próximo episódio em ${countdown}s` : "Próximo episódio"}
          </button>
        </div>
      )}
    </div>
  );
}
