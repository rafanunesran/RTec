import { useEffect, useState } from "react";
import { Cast, FastForward, Loader2, Monitor, Pause, Play, Rewind, RotateCw, Smartphone, Square, Tv, Unplug, Volume1, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog } from "@/components/ui";
import { castControl, findDevices, setCastTarget, useCast, type CastAction, type CastDevice, type DeviceKind } from "@/lib/cast";
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
      className={cn(target && "bg-brand/15 text-brand hover:bg-brand/25 hover:text-brand", className)}
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
                  on && "border-brand bg-brand/10",
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

/** Barra de baixo enquanto conectado: o que esta tocando no outro aparelho e o controle dele. */
export function CastBar({ onOpen }: { onOpen: () => void }) {
  const { target, state } = useCast();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!state || state.paused || state.live || !state.dur) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  if (!target) return null;

  const pos = state ? Math.min(state.dur || Infinity, state.pos + (state.paused || state.live ? 0 : (Date.now() - state.at) / 1000)) : 0;
  const ctl = (a: CastAction) => castControl(a).catch(() => toast.error(`Não foi possível falar com ${target.name}`));
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
        <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left hover:bg-white/5" title="Trocar de aparelho">
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
              <Cast className="h-3 w-3 shrink-0 text-brand" /> {target.name}
              {state && !state.live && state.dur > 0 && ` · ${clock(pos)} / ${clock(state.dur)}`}
              {state?.live && " · Ao vivo"}
            </span>
          </span>
        </button>
        {state && (
          <>
            {!state.live && (
              <button onClick={() => ctl("back")} className={cn(btn, "hidden sm:grid")} aria-label="Voltar 30 segundos">
                <Rewind className="h-5 w-5" />
              </button>
            )}
            <button onClick={() => ctl("toggle")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-black" aria-label={state.paused ? "Continuar" : "Pausar"}>
              {state.paused ? <Play className="h-5 w-5 fill-current" /> : <Pause className="h-5 w-5 fill-current" />}
            </button>
            {!state.live && (
              <button onClick={() => ctl("fwd")} className={btn} aria-label="Avançar 30 segundos">
                <FastForward className="h-5 w-5" />
              </button>
            )}
            <button onClick={() => ctl("voldown")} className={cn(btn, "hidden sm:grid")} aria-label="Diminuir volume">
              <Volume1 className="h-5 w-5" />
            </button>
            <button onClick={() => ctl("volup")} className={cn(btn, "hidden sm:grid")} aria-label="Aumentar volume">
              <Volume2 className="h-5 w-5" />
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
