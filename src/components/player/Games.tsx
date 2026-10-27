import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, BellRing, Loader2, Play, RotateCw, Search, SlidersHorizontal, Star, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { api, type Channel, type Game, type GameLeague, type GameTeam, type GamesResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, Dialog, EmptyState, Input, Skeleton } from "@/components/ui";
import {
  NO_PREFS,
  fold,
  hasPrefs,
  isFavTeam,
  loadAlerts,
  loadPrefs,
  matchesPrefs,
  saveAlerts,
  savePrefs,
  toggleAlert,
  useGamesStore,
  type GameAlert,
  type GamePrefs,
} from "@/lib/gameprefs";

const REFRESH_MS = 5 * 60_000;
const TZ = "America/Sao_Paulo";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const hour = (d: Date) => d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

function dayLabel(key: string) {
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  if (key === today) return "Hoje";
  if (key === tomorrow) return "Amanhã";
  const d = new Date(`${key}T12:00:00-03:00`);
  const s = d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "em 25 min", "em 2h 10", "em 1 dia". Vazio quando ja passou. */
function countdown(start: string, now: number) {
  const min = Math.ceil((Date.parse(start) - now) / 60_000);
  if (min <= 0) return "";
  if (min < 60) return `em ${min} min`;
  if (min < 24 * 60) return `em ${Math.floor(min / 60)}h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;
  return "";
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Chip({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Aba "Jogos do dia": o servidor monta a agenda e ja diz quais canais da lista do cliente passam cada jogo.
 * Aqui so filtra, mostra e toca (o aparelho nao busca nem cruza nada).
 */
export default function GamesPage({ onPlay, isLocked, currentId, tv }: { onPlay: (c: Channel, list: Channel[]) => void; isLocked: (group: string) => boolean; currentId?: string; tv?: boolean }) {
  const [data, setData] = useState<GamesResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(false);
  const [sport, setSport] = useState("");
  const [league, setLeague] = useState("");
  const [query, setQuery] = useState("");
  const prefs = useGamesStore(loadPrefs);
  const alerts = useGamesStore(loadAlerts);
  const [usePrefs, setUsePrefs] = useState(true);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const now = useNow();

  const load = () => {
    setLoading(true);
    api
      .get<GamesResponse>("/api/player/games")
      .then((r) => {
        setData(r);
        setError("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const games = useMemo(
    () => (data?.games ?? []).map((g) => ({ ...g, channels: g.channels.filter((c) => !isLocked(c.group)) })),
    [data, isLocked],
  );
  const prefsOn = usePrefs && hasPrefs(prefs);
  // Base: lista do cliente (ou todos) + preferencias. Os chips de esporte/campeonato e a busca refinam.
  const base = games.filter((g) => (all || g.channels.length) && (!prefsOn || matchesPrefs(prefs, g)));
  const sports = [...new Set(base.map((g) => g.sport))];
  const bySport = base.filter((g) => !sport || g.sport === sport);
  const leagues = [...new Map(bySport.map((g) => [g.league_id, g.league])).entries()];
  const q = fold(query);
  const shown = bySport
    .filter((g) => !league || g.league_id === league)
    .filter((g) => !q || [g.home.name, g.away.name, g.league].some((t) => fold(t).includes(q)));
  const mineCount = games.filter((g) => g.channels.length && (!prefsOn || matchesPrefs(prefs, g))).length;
  const allCount = games.filter((g) => !prefsOn || matchesPrefs(prefs, g)).length;

  // Escolha que sumiu da lista (ex: trocou de "Todos" para "Na minha lista"): volta para todos.
  useEffect(() => {
    if (sport && !sports.includes(sport)) setSport("");
  }, [sport, sports.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (league && !leagues.some(([id]) => id === league)) setLeague("");
  }, [league, leagues.map(([id]) => id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => {
    const out: { key: string; games: Game[] }[] = [];
    for (const g of shown) {
      const k = g.state === "in" ? dayKey(new Date()) : dayKey(new Date(g.start));
      const d = out.find((x) => x.key === k) ?? (out.push({ key: k, games: [] }), out[out.length - 1]);
      d.games.push(g);
    }
    return out;
  }, [shown]);

  if (!data && !error) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (!data) {
    return (
      <EmptyState
        icon={<Trophy className="h-6 w-6" />}
        title="Não deu para carregar os jogos"
        text={error}
        action={
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RotateCw />} Tentar de novo
          </Button>
        }
      />
    );
  }

  const alertOn = (id: string) => alerts.some((a) => a.id === id);
  const onAlert = (g: Game) => {
    const on = toggleAlert(g);
    if (on) {
      toast.success("Alerta criado", { description: `Vamos avisar quando ${g.home.name} x ${g.away.name} começar.` });
      // Navegador: pede para avisar tambem com o app em segundo plano (opcional).
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
    } else toast("Alerta removido");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={cn("mr-auto font-bold tracking-tight", tv ? "text-2xl" : "text-lg")}>Jogos do dia</h2>
        <Chip active={!all} onClick={() => setAll(false)}>Na minha lista ({mineCount})</Chip>
        <Chip active={all} onClick={() => setAll(true)}>Todos ({allCount})</Chip>
        <Button variant="outline" size="sm" onClick={() => setPrefsOpen(true)} aria-label="Preferências dos jogos">
          <SlidersHorizontal /> Preferências
        </Button>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar time ou campeonato..." className="pl-9" aria-label="Buscar time ou campeonato" />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Limpar busca">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-0.5">
          {hasPrefs(prefs) && (
            <Chip active={usePrefs} onClick={() => setUsePrefs((v) => !v)}>
              <Star className={cn("h-3.5 w-3.5", usePrefs && "fill-current")} /> Minhas preferências
            </Chip>
          )}
          <Chip active={!sport} onClick={() => setSport("")}>Todos os esportes</Chip>
          {sports.map((s) => (
            <Chip key={s} active={sport === s} onClick={() => setSport(sport === s ? "" : s)}>
              {s}
            </Chip>
          ))}
          {prefs.teams.map((t) => (
            <Chip key={t} active={fold(query) === fold(t)} onClick={() => setQuery(fold(query) === fold(t) ? "" : t)}>
              <Star className="h-3 w-3 fill-current text-warning" /> {t}
            </Chip>
          ))}
        </div>
        {leagues.length > 1 && (
          <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-0.5">
            <Chip active={!league} onClick={() => setLeague("")} className="py-1">Todos os campeonatos</Chip>
            {leagues.map(([id, name]) => (
              <Chip key={id} active={league === id} onClick={() => setLeague(league === id ? "" : id)} className="py-1">
                {name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {!shown.length && (
        <EmptyState
          icon={<Trophy className="h-6 w-6" />}
          title={games.length ? "Nenhum jogo com esses filtros" : "Nenhum jogo na agenda"}
          text={
            !games.length
              ? "Não encontramos jogos para hoje e os próximos dias."
              : !all
                ? "Pode ser que passem em canais que a sua lista não tem. Toque em Todos para ver onde passam."
                : "Mude o esporte, o campeonato ou a busca."
          }
        />
      )}

      {days.map((d) => (
        <section key={d.key} className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{dayLabel(d.key)}</h3>
          <ul className="grid gap-3 lg:grid-cols-2">
            {d.games.map((g) => (
              <GameCard key={g.id} game={g} now={now} prefs={prefs} onPlay={onPlay} currentId={currentId} alert={alertOn(g.id)} onAlert={() => onAlert(g)} />
            ))}
          </ul>
        </section>
      ))}

      {data.updated_at && <p className="text-center text-[11px] text-muted-foreground">Agenda atualizada às {hour(new Date(data.updated_at))}</p>}

      {prefsOpen && <PrefsDialog prefs={prefs} leagues={data.leagues ?? []} teams={games.flatMap((g) => [g.home.name, g.away.name])} onClose={() => setPrefsOpen(false)} />}
    </div>
  );
}

function Team({ team, right, fav }: { team: GameTeam; right?: boolean; fav?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", right && "flex-row-reverse text-right")}>
      <div className="grid h-8 w-8 shrink-0 place-items-center">
        {team.logo ? <img src={team.logo} alt="" loading="lazy" className="h-8 w-8 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} /> : <Trophy className="h-4 w-4 text-muted-foreground" />}
      </div>
      <span className="line-clamp-2 min-w-0 break-words text-sm font-semibold leading-tight">
        {fav && <Star className={cn("inline h-3.5 w-3.5 fill-warning text-warning", right ? "ml-1" : "mr-1")} aria-label="Time favorito" />}
        {team.name}
      </span>
    </div>
  );
}

function GameCard({
  game: g,
  now,
  prefs,
  onPlay,
  currentId,
  alert,
  onAlert,
}: {
  game: Game;
  now: number;
  prefs: GamePrefs;
  onPlay: (c: Channel, list: Channel[]) => void;
  currentId?: string;
  alert: boolean;
  onAlert: () => void;
}) {
  const live = g.state === "in";
  const started = live || Date.parse(g.start) <= now;
  const soon = !started && Date.parse(g.start) - now < 60 * 60_000;
  const missing = g.broadcasts.filter((b) => !g.channels.some((c) => c.broadcast === b));
  return (
    <li className={cn("flex overflow-hidden rounded-2xl border bg-card", live && "border-destructive/50", alert && !live && "border-primary/50")}>
      {/* Horario em destaque, a esquerda */}
      <div className={cn("flex w-[88px] shrink-0 flex-col items-center justify-center gap-1 border-r px-2 py-3 text-center", live ? "bg-destructive/10" : soon ? "bg-primary/10" : "bg-muted/40")}>
        {live ? (
          <>
            <span className="inline-flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[11px] font-bold text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> AO VIVO
            </span>
            <span className="text-2xl font-extrabold tabular-nums leading-none">
              {g.home.score || 0}-{g.away.score || 0}
            </span>
            {g.detail && <span className="text-[11px] font-semibold text-destructive">{g.detail}</span>}
          </>
        ) : (
          <>
            <span className="text-2xl font-extrabold tabular-nums leading-none tracking-tight">{hour(new Date(g.start))}</span>
            <span className={cn("text-[11px] font-semibold", soon ? "text-primary" : "text-muted-foreground")}>{started ? "começando" : countdown(g.start, now) || dayLabel(dayKey(new Date(g.start))).split(",")[0]}</span>
          </>
        )}
      </div>

      <div className="min-w-0 flex-1 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="truncate font-semibold uppercase tracking-wide">{g.league}</span>
          {!started && (
            <button
              onClick={onAlert}
              aria-pressed={alert}
              aria-label={alert ? "Remover alerta" : "Avisar quando começar"}
              title={alert ? "Remover alerta" : "Avisar quando começar"}
              className={cn(
                "ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-semibold transition-colors",
                alert ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {alert ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
              {alert ? "Alerta ativo" : "Alertar"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Team team={g.home} fav={isFavTeam(prefs, g.home.name)} />
          <span className="shrink-0 px-1 text-sm font-bold text-muted-foreground">x</span>
          <Team team={g.away} right fav={isFavTeam(prefs, g.away.name)} />
        </div>
        {!!g.channels.length && <ChannelButtons game={g} onPlay={onPlay} currentId={currentId} />}
        {(!!missing.length || !g.broadcasts.length || g.guessed) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {g.guessed && !missing.length ? (
              "Canais de costume do campeonato"
            ) : g.broadcasts.length ? (
              <>
                {g.channels.length ? "Também passa em" : "Passa em"} {missing.join(", ")}
                {!g.channels.length && " · não está na sua lista"}
              </>
            ) : (
              "Canal ainda não informado"
            )}
            {g.guessed && missing.length > 0 && " (canal provável)"}
          </p>
        )}
      </div>
    </li>
  );
}

function ChannelButtons({ game: g, onPlay, currentId }: { game: Game; onPlay: (c: Channel, list: Channel[]) => void; currentId?: string }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {g.channels.map((c) => (
        <button
          key={c.id}
          onClick={() => onPlay(c, g.channels)}
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
            currentId === c.id ? "bg-primary text-primary-foreground" : "bg-foreground text-background hover:opacity-90",
          )}
        >
          <Play className="h-3 w-3 shrink-0 fill-current" />
          <span className="truncate">{c.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Preferencias: pre-filtra a aba por esportes, campeonatos e times (salvo no aparelho, por perfil). */
function PrefsDialog({ prefs, leagues, teams, onClose }: { prefs: GamePrefs; leagues: GameLeague[]; teams: string[]; onClose: () => void }) {
  const [p, setP] = useState<GamePrefs>(prefs);
  const [team, setTeam] = useState("");
  const toggle = (k: "sports" | "leagues", v: string) => setP((o) => ({ ...o, [k]: o[k].includes(v) ? o[k].filter((x) => x !== v) : [...o[k], v] }));
  const addTeam = (name: string) => {
    const n = name.trim();
    if (n && !isFavTeam(p, n)) setP((o) => ({ ...o, teams: [...o.teams, n] }));
    setTeam("");
  };
  const sports = [...new Set(leagues.map((l) => l.sport))];
  const known = [...new Set(teams)].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const suggestions = team.trim() ? known.filter((t) => fold(t).includes(fold(team)) && !isFavTeam(p, t)).slice(0, 8) : [];
  return (
    <Dialog open onClose={onClose} title="Preferências dos jogos" description="A aba Jogos do dia já abre filtrada assim. Deixe em branco para ver tudo." icon={<SlidersHorizontal className="h-5 w-5" />} wide>
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Meus times</h3>
          <p className="text-xs text-muted-foreground">Os jogos deles sempre aparecem, com estrela.</p>
          <div className="flex gap-2">
            <Input value={team} onChange={(e) => setTeam(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTeam(team)} placeholder="Nome do time (ex: Flamengo)" aria-label="Nome do time" />
            <Button variant="outline" onClick={() => addTeam(team)} disabled={!team.trim()}>
              Adicionar
            </Button>
          </div>
          {!!suggestions.length && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((t) => (
                <Chip key={t} active={false} onClick={() => addTeam(t)}>
                  + {t}
                </Chip>
              ))}
            </div>
          )}
          {!!p.teams.length && (
            <div className="flex flex-wrap gap-1.5">
              {p.teams.map((t) => (
                <Chip key={t} active onClick={() => setP((o) => ({ ...o, teams: o.teams.filter((x) => x !== t) }))}>
                  <Star className="h-3 w-3 fill-current" /> {t} <X className="h-3 w-3" />
                </Chip>
              ))}
            </div>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Esportes</h3>
          <div className="flex flex-wrap gap-1.5">
            {sports.map((s) => (
              <Chip key={s} active={p.sports.includes(s)} onClick={() => toggle("sports", s)}>
                {s}
              </Chip>
            ))}
          </div>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Campeonatos</h3>
          {sports.map((s) => (
            <div key={s} className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s}</div>
              <div className="flex flex-wrap gap-1.5">
                {leagues
                  .filter((l) => l.sport === s)
                  .map((l) => (
                    <Chip key={l.id} active={p.leagues.includes(l.id)} onClick={() => toggle("leagues", l.id)}>
                      {l.name}
                    </Chip>
                  ))}
              </div>
            </div>
          ))}
        </section>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setP(NO_PREFS)}>
            Limpar
          </Button>
          <Button
            variant="gradient"
            onClick={() => {
              savePrefs(p);
              onClose();
            }}
          >
            Salvar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const ALERT_KEEP_MS = 3 * 3600_000; // alerta de jogo que ja passou disso some sem avisar

/**
 * Fica sempre montado no reprodutor: quando chega a hora de um jogo com alerta, abre um aviso com os canais
 * da lista para assistir (busca a agenda na hora, para os links estarem novos).
 */
export function GameAlerts({ onPlay, isLocked }: { onPlay: (c: Channel, list: Channel[]) => void; isLocked: (group: string) => boolean }) {
  const [due, setDue] = useState<{ alert: GameAlert; game: Game | null } | null>(null);
  const checking = useRef(false);
  useEffect(() => {
    const check = async () => {
      if (checking.current || due) return;
      const now = Date.now();
      const list = loadAlerts();
      const old = list.filter((a) => Date.parse(a.start) < now - ALERT_KEEP_MS);
      if (old.length) saveAlerts(list.filter((a) => !old.includes(a)));
      const alert = list.find((a) => !old.includes(a) && Date.parse(a.start) <= now);
      if (!alert) return;
      checking.current = true;
      saveAlerts(loadAlerts().filter((a) => a.id !== alert.id));
      let game: Game | null = null;
      try {
        const r = await api.get<GamesResponse>("/api/player/games");
        const g = r.games.find((x) => x.id === alert.id);
        if (g) game = { ...g, channels: g.channels.filter((c) => !isLocked(c.group)) };
      } catch {
        /* sem rede: avisa mesmo assim, sem os canais */
      }
      checking.current = false;
      const title = `Começou: ${alert.home.name} x ${alert.away.name}`;
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        try {
          new Notification(title, { body: alert.league, icon: "/icons/icon-192.png" });
        } catch {
          /* celular sem suporte a notificacao fora do service worker */
        }
      }
      setDue({ alert, game });
    };
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => clearInterval(t);
  }, [due, isLocked]);

  if (!due) return null;
  const { alert, game } = due;
  return (
    <Dialog open onClose={() => setDue(null)} title={`Começou: ${alert.home.name} x ${alert.away.name}`} description={alert.league} icon={<BellRing className="h-6 w-6 text-primary" />}>
      {game?.channels.length ? (
        <>
          <p className="text-sm text-muted-foreground">Assista agora em:</p>
          <ChannelButtons
            game={game}
            onPlay={(c, list) => {
              setDue(null);
              onPlay(c, list);
            }}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {game?.broadcasts.length ? `Passa em ${game.broadcasts.join(", ")}, que não está na sua lista.` : "Veja na aba Jogos do dia onde está passando."}
        </p>
      )}
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={() => setDue(null)}>
          Fechar
        </Button>
      </div>
    </Dialog>
  );
}
