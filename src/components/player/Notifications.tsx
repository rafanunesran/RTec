import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, BellRing, ChevronRight, Clapperboard, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Channel, type Game, type GamesResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, EmptyState } from "@/components/ui";
import { epLabel, setEpAlert, useEpAlerts, type EpAlert } from "@/lib/epalerts";
import { loadAlerts, loadPrefs, markGamesSeen, removeAlert, unseenGames, useGamesStore, type GameAlert } from "@/lib/gameprefs";
import { GameCard, dayKey, dayLabel, hour, useNow } from "./Games";

// Tela de notificacoes: junta os alertas de novos episodios (series) e os alertas dos Jogos do dia.
// Celular: sino no topo, ao lado de Configuracoes. TV: item "Notificacoes" no menu lateral.

/** Numero do sino: series com episodio novo + jogos com alerta que ja comecaram e ainda nao foram vistos. */
export function useNotificationCount() {
  const eps = useEpAlerts();
  const games = useGamesStore(loadAlerts);
  return eps.filter((a) => a.new > 0).length + unseenGames(games).length;
}

/** Bolinha com o numero, por cima do icone do sino. */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        "pointer-events-none absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background",
        className,
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

export default function NotificationsPage({
  onOpenSeries,
  onPlay,
  onGames,
  isLocked,
  currentId,
  tv,
}: {
  onOpenSeries: (a: EpAlert) => void;
  onPlay: (c: Channel, list: Channel[]) => void;
  onGames: () => void;
  isLocked: (group: string) => boolean;
  currentId?: string;
  tv?: boolean;
}) {
  const eps = useEpAlerts();
  const alerts = useGamesStore(loadAlerts);
  const prefs = useGamesStore(loadPrefs);
  const now = useNow();
  const [agenda, setAgenda] = useState<Game[] | null>(null);

  // Abriu a tela: os "Começou" deixam de contar no sino (continuam listados ate sumirem).
  useEffect(() => {
    markGamesSeen();
  }, [alerts.length]);

  // Agenda atual, para mostrar placar/ao vivo e os canais de cada jogo com alerta.
  useEffect(() => {
    if (!alerts.length) return;
    let alive = true;
    api
      .get<GamesResponse>("/api/player/games")
      .then((r) => alive && setAgenda(r.games.map((g) => ({ ...g, channels: g.channels.filter((c) => !isLocked(c.group)) }))))
      .catch(() => alive && setAgenda([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.length > 0]);

  const withNew = eps.filter((a) => a.new > 0);
  const following = eps.filter((a) => a.new <= 0).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const games = useMemo(() => [...alerts].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), [alerts]);
  const started = games.filter((a) => a.fired || Date.parse(a.start) <= now);
  const upcoming = games.filter((a) => !started.includes(a));

  const offSeries = (a: EpAlert) => {
    void setEpAlert({ id: a.id, name: a.name, logo: a.logo, series_id: a.series_id }, false).catch(() => toast.error("Não deu para desligar agora. Tente de novo."));
    toast(`Alerta de ${a.name} desligado`);
  };
  const offGame = (a: GameAlert) => {
    removeAlert(a.id);
    toast("Alerta removido");
  };

  const title = cn("mb-3 flex items-center gap-2 font-bold tracking-tight", tv ? "text-xl" : "text-base");

  if (!eps.length && !games.length) {
    return (
      <div className="space-y-5">
        <h2 className={cn("font-bold tracking-tight", tv ? "text-2xl" : "text-lg")}>Notificações</h2>
        <EmptyState
          icon={<Bell className="h-6 w-6" />}
          title="Nenhum alerta criado"
          text="Toque em “Avisar novos episódios” numa série (as favoritas entram sozinhas) ou em “Alertar” num jogo. Os avisos aparecem aqui."
          action={
            <Button variant="outline" onClick={onGames}>
              <Trophy /> Ver Jogos do dia
            </Button>
          }
        />
      </div>
    );
  }

  const gameCard = (a: GameAlert) => {
    const g = agenda?.find((x) => x.id === a.id);
    if (g) return <GameCard key={a.id} game={g} now={now} prefs={prefs} onPlay={onPlay} currentId={currentId} alert onAlert={() => offGame(a)} />;
    // Sem a agenda (sem rede, ou o jogo ja saiu dela): o basico guardado no aparelho.
    const start = new Date(a.start);
    return (
      <li key={a.id} className="flex items-center gap-3 rounded-2xl border bg-card p-3 sm:p-4">
        <div className="w-16 shrink-0 text-center">
          <div className="text-lg font-bold tabular-nums leading-none">{hour(start)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{dayLabel(dayKey(start))}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {a.home.name} x {a.away.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">{a.league}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => offGame(a)} aria-label={`Remover alerta de ${a.home.name} x ${a.away.name}`}>
          <X /> Remover
        </Button>
      </li>
    );
  };

  return (
    <div className="space-y-8">
      <h2 className={cn("font-bold tracking-tight", tv ? "text-2xl" : "text-lg")}>Notificações</h2>

      {!!withNew.length && (
        <section>
          <h3 className={title}>
            <BellRing className="h-5 w-5 text-primary" /> Novos episódios
          </h3>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {withNew.map((a) => (
              <SeriesRow key={a.id} alert={a} highlight onOpen={() => onOpenSeries(a)} />
            ))}
          </ul>
        </section>
      )}

      {!!started.length && (
        <section>
          <h3 className={title}>
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" /> Jogos que começaram
          </h3>
          <ul className="grid gap-3 lg:grid-cols-2">{started.map(gameCard)}</ul>
        </section>
      )}

      {!!upcoming.length && (
        <section>
          <h3 className={title}>
            <Trophy className="h-5 w-5 text-primary" /> Jogos com alerta
          </h3>
          <ul className="grid gap-3 lg:grid-cols-2">{upcoming.map(gameCard)}</ul>
        </section>
      )}

      {!!following.length && (
        <section>
          <h3 className={title}>
            <Bell className="h-5 w-5 text-muted-foreground" /> Séries que você acompanha
          </h3>
          <p className="-mt-1 mb-3 text-xs text-muted-foreground">Avisamos aqui quando sair episódio novo. Nada novo por enquanto.</p>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {following.map((a) => (
              <SeriesRow key={a.id} alert={a} onOpen={() => onOpenSeries(a)} onOff={() => offSeries(a)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SeriesRow({ alert: a, highlight, onOpen, onOff }: { alert: EpAlert; highlight?: boolean; onOpen: () => void; onOff?: () => void }) {
  return (
    <li className={cn("flex items-center gap-1 rounded-2xl border bg-card p-1.5", highlight && "border-primary/50 bg-primary/[0.06]")}>
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted">
        <div className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-border">
          {a.logo ? <img src={a.logo} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} /> : <Clapperboard className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{a.name}</div>
          <div className={cn("truncate text-xs", highlight ? "text-primary" : "text-muted-foreground")}>{highlight ? epLabel(a) : a.fav ? "Favorita · alerta ligado" : "Alerta ligado"}</div>
        </div>
        {highlight && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {onOff && (
        <button
          onClick={onOff}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted"
          aria-label={`Desligar alerta de ${a.name}`}
          title="Desligar alerta"
        >
          <BellOff className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
