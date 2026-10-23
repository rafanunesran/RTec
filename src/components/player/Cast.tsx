import { useEffect, useState } from "react";
import { Captions, Cast, ChevronDown, Heart, ListRestart, ListVideo, Loader2, Monitor, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Smartphone, Square, Tv, Unplug, Volume1, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog } from "@/components/ui";
import type { Channel } from "@/lib/api";
import { castControl, castPos, findDevices, knownDevices, setCastTarget, thisDevice, useCast, type CastAction, type CastDevice, type DeviceKind } from "@/lib/cast";
import { ListPanel, TracksPanel } from "@/components/player/PlayerOverlay";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<DeviceKind, typeof Tv> = { tv: Tv, phone: Smartphone, pc: Monitor };

/** Botao "Tocar em outro aparelho" do topo: fica colorido enquanto esta conectado a um aparelho. */
export function CastButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const { target } = useCast();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={target ? `Tocando em ${target.name}` : "Tocar em outro aparelho"}
      aria-label={target ? `Tocando em ${target.name}` : "Tocar em outro aparelho"}
      aria-pressed={!!target}
      className={cn(target && "bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary", className)}
    >
      <Cast className="!size-5" />
    </Button>
  );
}

/**
 * Lista os aparelhos da conta com o app aberto. Escolhendo um, o que for tocado aqui passa a tocar nele
 * (`onPick` recebe o aparelho, para mandar na hora o que ja esta passando).
 */
export function CastDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick?: (d: CastDevice) => void }) {
  const { target } = useCast();
  const [devices, setDevices] = useState<CastDevice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setDevices(null);
    setFailed(false);
    findDevices()
      .then((list) => alive && setDevices(list))
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setDevices([]);
      });
    return () => {
      alive = false;
    };
  }, [open, round]);

  const pick = (d: CastDevice) => {
    setCastTarget(d);
    onPick?.(d);
    if (!onPick) toast.success(`Conectado a ${d.name}. Escolha o que assistir e vai tocar lá.`);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Tocar em outro aparelho" description="Aparelhos com o RTec aberto nesta conta" icon={<Cast className="h-5 w-5" />}>
      <div className="space-y-2">
        {devices === null ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Procurando aparelhos…
          </div>
        ) : devices.length === 0 ? (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            {failed ? "Não foi possível procurar os aparelhos. Confira a internet e tente de novo." : "Nenhum aparelho encontrado. Abra o RTec na TV, entre com esta mesma conta e deixe o app na tela."}
          </div>
        ) : (
          devices.map((d) => {
            const Icon = KIND_ICON[d.kind];
            const on = target?.id === d.id;
            return (
              <button
                key={d.id}
                onClick={() => pick(d)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-accent",
                  on && "border-primary bg-primary/10",
                )}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{d.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{on ? "Conectado" : d.title ? `Passando: ${d.title}` : "Pronto para tocar"}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {target && (
          <Button
            variant="outline"
            onClick={() => {
              setCastTarget(null);
              onClose();
            }}
          >
            <Unplug className="h-4 w-4" /> Desconectar
          </Button>
        )}
        <Button variant="secondary" onClick={() => setRound((r) => r + 1)} disabled={devices === null}>
          <RotateCw className="h-4 w-4" /> Procurar de novo
        </Button>
      </div>
    </Dialog>
  );
}

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

/** Atualiza a tela a cada segundo enquanto o outro aparelho toca (a barra de tempo anda sozinha). */
function useTicking(on: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

const failed = (name: string) => () => toast.error(`Não foi possível falar com ${name}`);

/** Barra de baixo enquanto conectado: o que esta tocando no outro aparelho; tocando nela abre o controle completo. */
export function CastBar({ onOpen }: { onOpen: () => void }) {
  const { target, state } = useCast();
  useTicking(!!state && !state.paused && !state.live && state.dur > 0);
  if (!target) return null;

  const pos = state ? castPos(state) : 0;
  const ctl = (a: CastAction) => castControl(a).catch(failed(target.name));
  const Icon = KIND_ICON[target.kind];
  const btn = "grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-white/10";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] text-white backdrop-blur">
      {state && !state.live && state.dur > 0 && (
        <div className="h-1 bg-white/10">
          <div className="h-full bg-brand" style={{ width: `${(pos / state.dur) * 100}%` }} />
        </div>
      )}
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-2 lg:px-6">
        <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left hover:bg-white/5" title={state ? "Abrir o controle" : "Trocar de aparelho"}>
          {state?.logo ? (
            <img src={state.logo} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white/10">
              <Icon className="h-5 w-5" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{state ? state.title : "Escolha o que assistir"}</span>
            <span className="flex items-center gap-1 truncate text-xs text-white/60">
              <Cast className="h-3 w-3 shrink-0 text-primary" /> {target.name}
              {state && !state.live && state.dur > 0 && ` · ${clock(pos)} / ${clock(state.dur)}`}
              {state?.live && " · Ao vivo"}
            </span>
          </span>
        </button>
        {state && (
          <>
            <button onClick={() => ctl("toggle")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-black" aria-label={state.paused ? "Continuar" : "Pausar"}>
              {state.paused ? <Play className="h-5 w-5 fill-current" /> : <Pause className="h-5 w-5 fill-current" />}
            </button>
            <button onClick={() => ctl("stop")} className={btn} aria-label="Parar">
              <Square className="h-4 w-4 fill-current" />
            </button>
          </>
        )}
        <button onClick={() => setCastTarget(null)} className={btn} aria-label="Desconectar" title="Desconectar">
          <Unplug className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Controle completo do que toca no outro aparelho, com os mesmos comandos do player: pausar, voltar/avancar 10 s,
 * barra de tempo, anterior/proximo, recomecar, lista de episodios/canais, audio e legendas e volume.
 */
export function CastRemote({
  playlist,
  prev,
  next,
  onPick,
  favorite,
  onFavorite,
  onHere,
  onClose,
}: {
  playlist?: Channel[] | null;
  prev?: Channel | null;
  next?: Channel | null;
  /** Escolheu outro episodio/canal (anterior, proximo ou na lista): toca no outro aparelho. */
  onPick: (c: Channel) => void;
  favorite: boolean;
  onFavorite: () => void;
  /** Trazer para este aparelho, do ponto onde esta. */
  onHere: (item: Channel, pos: number, dur: number) => void;
  onClose: () => void;
}) {
  const { target, state } = useCast();
  const [panel, setPanel] = useState<"list" | "tracks" | null>(null);
  const [drag, setDrag] = useState<number | null>(null); // posicao escolhida na barra enquanto arrasta
  useTicking(!!state && !state.paused && !state.live && state.dur > 0);
  // Parou ou desconectou: o controle fecha sozinho.
  useEffect(() => {
    if (!target || !state) onClose();
  }, [target, state, onClose]);
  if (!target || !state) return null;

  const ctl = (a: CastAction, v?: number) => castControl(a, v).catch(failed(target.name));
  const vod = !state.live && state.dur > 0;
  const pos = drag ?? castPos(state);
  const series = state.item.kind === "series";
  const listLabel = series ? "Episódios" : "Canais";
  const hasTracks = state.tracks.audio.length > 1 || state.tracks.text.length > 0;
  const round = "grid place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30";
  const VolIcon = state.muted || state.volume === 0 ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2;

  return (
    <div role="dialog" aria-label="Controle" className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white">
      {state.logo && <img src={state.logo} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-20 blur-2xl" />}
      <div className="relative flex items-center gap-2 px-3 pt-[max(12px,env(safe-area-inset-top))]">
        <button onClick={onClose} className={cn(round, "h-11 w-11")} aria-label="Minimizar">
          <ChevronDown className="h-6 w-6" />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-xs font-semibold text-white/70">
          <Cast className="h-3.5 w-3.5 text-primary" /> <span className="truncate">Tocando em {target.name}</span>
        </div>
        <button onClick={onFavorite} className={cn(round, "h-11 w-11")} aria-label="Favorito">
          <Heart className={cn("h-5 w-5", favorite && "fill-red-500 text-red-500")} />
        </button>
      </div>

      <div className="relative mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6">
        <div className="mx-auto aspect-video w-full max-w-sm overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10">
          {state.logo ? (
            <img src={state.logo} alt="" className="h-full w-full object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : (
            <div className="grid h-full place-items-center">
              <Tv className="h-12 w-12 text-white/30" />
            </div>
          )}
        </div>
        <div className="text-center">
          <div className="line-clamp-2 text-xl font-bold">{state.title}</div>
          <div className="mt-1 truncate text-sm text-white/60">{state.item.group}</div>
        </div>

        {vod ? (
          <div>
            <input
              type="range"
              min={0}
              max={Math.round(state.dur)}
              step={1}
              value={Math.round(pos)}
              aria-label="Barra de tempo"
              onChange={(e) => setDrag(Number(e.target.value))}
              onPointerUp={() => drag !== null && (ctl("seek", drag), setDrag(null))}
              onKeyUp={() => drag !== null && (ctl("seek", drag), setDrag(null))}
              className="w-full accent-[hsl(var(--primary))]"
            />
            <div className="flex justify-between text-xs tabular-nums text-white/60">
              <span>{clock(pos)}</span>
              <span>-{clock(state.dur - pos)}</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <span className="flex items-center gap-2 rounded-md bg-red-600 px-2.5 py-1 text-xs font-bold uppercase tracking-wider">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Ao vivo
            </span>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 sm:gap-5">
          <button onClick={() => prev && onPick(prev)} disabled={!prev} className={cn(round, "h-12 w-12")} aria-label={series ? "Episódio anterior" : "Canal anterior"}>
            <SkipBack className="h-5 w-5 fill-current" />
          </button>
          {vod && (
            <button onClick={() => ctl("back")} className={cn(round, "h-12 w-12")} aria-label="Voltar 10 segundos">
              <RotateCcw className="h-5 w-5" />
            </button>
          )}
          <button onClick={() => ctl("toggle")} className="grid h-16 w-16 place-items-center rounded-full bg-white text-black" aria-label={state.paused ? "Continuar" : "Pausar"}>
            {state.paused ? <Play className="h-7 w-7 fill-current" /> : <Pause className="h-7 w-7 fill-current" />}
          </button>
          {vod && (
            <button onClick={() => ctl("fwd")} className={cn(round, "h-12 w-12")} aria-label="Avançar 10 segundos">
              <RotateCw className="h-5 w-5" />
            </button>
          )}
          <button onClick={() => next && onPick(next)} disabled={!next} className={cn(round, "h-12 w-12")} aria-label={series ? "Próximo episódio" : "Próximo canal"}>
            <SkipForward className="h-5 w-5 fill-current" />
          </button>
        </div>

        <div className="flex items-center justify-center gap-3">
          <button onClick={() => ctl("voldown")} className={cn(round, "h-11 w-11")} aria-label="Diminuir volume">
            <Volume1 className="h-5 w-5" />
          </button>
          <button onClick={() => ctl("mute")} className={cn(round, "h-11 w-11", state.muted && "bg-white text-black hover:bg-white/90")} aria-label={state.muted ? "Tirar do mudo" : "Mudo"} aria-pressed={state.muted}>
            <VolIcon className="h-5 w-5" />
          </button>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/15" aria-hidden>
            <div className="h-full bg-white" style={{ width: `${(state.muted ? 0 : state.volume) * 100}%` }} />
          </div>
          <button onClick={() => ctl("volup")} className={cn(round, "h-11 w-11")} aria-label="Aumentar volume">
            <Volume2 className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {vod && (
            <button onClick={() => ctl("seek", 0)} className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/20">
              <ListRestart className="h-4 w-4" /> Recomeçar
            </button>
          )}
          {playlist && (
            <button onClick={() => setPanel("list")} className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/20">
              <ListVideo className="h-4 w-4" /> {series ? "EPs" : "Canais"}
            </button>
          )}
          {hasTracks && (
            <button onClick={() => setPanel("tracks")} className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/20">
              <Captions className="h-4 w-4" /> Áudio e legendas
            </button>
          )}
        </div>
      </div>

      <div className="relative flex flex-wrap justify-center gap-2 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-2">
        <Button variant="secondary" onClick={() => onHere(state.item, vod ? castPos(state) : 0, state.dur)}>
          <Smartphone className="h-4 w-4" /> Tocar neste aparelho
        </Button>
        <Button variant="outline" onClick={() => ctl("stop")}>
          <Square className="h-4 w-4 fill-current" /> Parar
        </Button>
        <Button variant="ghost" onClick={() => setCastTarget(null)}>
          <Unplug className="h-4 w-4" /> Desconectar
        </Button>
      </div>

      {panel === "list" && playlist && (
        <ListPanel
          title={listLabel}
          items={playlist}
          currentId={state.item.id}
          series={series}
          onPick={(c) => {
            setPanel(null);
            onPick(c);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "tracks" && <TracksPanel tracks={state.tracks} onAudio={(id) => ctl("audio", id)} onText={(id) => ctl("text", id)} onClose={() => setPanel(null)} />}
    </div>
  );
}

/**
 * Ao dar play com outro aparelho da conta aberto: tocar aqui ou nele? Abre na hora com os aparelhos que ja se
 * sabe que estao abertos e confere de novo em segundo plano (quem nao responder sai da lista).
 */
export function WhereDialog({ title, onHere, onDevice, onClose }: { title: string; onHere: () => void; onDevice: (d: CastDevice) => void; onClose: () => void }) {
  const [devices, setDevices] = useState<CastDevice[]>(knownDevices);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let alive = true;
    findDevices()
      .then((list) => alive && setDevices(list))
      .catch(() => {})
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, []);
  const me = thisDevice();
  const MeIcon = KIND_ICON[me.kind];
  const row = "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-accent";
  return (
    <Dialog open onClose={onClose} title="Onde assistir?" description={title} icon={<Cast className="h-5 w-5" />}>
      <div className="space-y-2">
        <button autoFocus onClick={onHere} className={cn(row, "border-primary bg-primary/10")}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted">
            <MeIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">Neste aparelho</span>
            <span className="block truncate text-xs text-muted-foreground">{me.name}</span>
          </span>
        </button>
        {devices.map((d) => {
          const Icon = KIND_ICON[d.kind];
          return (
            <button key={d.id} onClick={() => onDevice(d)} className={row}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{d.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{d.title ? `Passando: ${d.title}` : "Pronto para tocar"}</span>
              </span>
              <Cast className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
        {checking && (
          <div className="flex items-center gap-2 px-1 pt-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Conferindo aparelhos abertos…
          </div>
        )}
        {!checking && !devices.length && <div className="px-1 pt-1 text-xs text-muted-foreground">Nenhum outro aparelho aberto agora.</div>}
      </div>
    </Dialog>
  );
}
