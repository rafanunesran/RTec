import { useEffect, useMemo, useState } from "react";
import { Loader2, Play, RotateCw, Trophy } from "lucide-react";
import { api, type Channel, type Game, type GameTeam, type GamesResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, EmptyState, Skeleton } from "@/components/ui";

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

/**
 * Aba "Jogos do dia": o servidor monta a agenda e ja diz quais canais da lista do cliente passam cada jogo.
 * Aqui so mostra e toca (o aparelho nao busca nem cruza nada).
 */
export default function GamesPage({ onPlay, isLocked, currentId, tv }: { onPlay: (c: Channel, list: Channel[]) => void; isLocked: (group: string) => boolean; currentId?: string; tv?: boolean }) {
  const [data, setData] = useState<GamesResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(false);

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
  const mine = games.filter((g) => g.channels.length);
  const shown = all ? games : mine;
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={cn("mr-auto font-bold tracking-tight", tv ? "text-2xl" : "text-lg")}>Jogos do dia</h2>
        {(
          [
            [false, `Na minha lista (${mine.length})`],
            [true, `Todos (${games.length})`],
          ] as const
        ).map(([v, label]) => (
          <button
            key={String(v)}
            onClick={() => setAll(v)}
            aria-pressed={all === v}
            className={cn("rounded-full px-3 py-1.5 text-xs font-semibold transition-colors", all === v ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      {!shown.length && (
        <EmptyState
          icon={<Trophy className="h-6 w-6" />}
          title={games.length ? "Nenhum jogo nos canais da sua lista" : "Nenhum jogo na agenda"}
          text={games.length ? "Os jogos de hoje e dos próximos dias passam em canais que a sua lista não tem. Veja todos para saber onde passam." : "Não encontramos jogos para hoje e os próximos dias."}
        />
      )}

      {days.map((d) => (
        <section key={d.key} className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{dayLabel(d.key)}</h3>
          <ul className="grid gap-3 lg:grid-cols-2">
            {d.games.map((g) => (
              <GameCard key={g.id} game={g} onPlay={onPlay} currentId={currentId} />
            ))}
          </ul>
        </section>
      ))}

      {data.updated_at && <p className="text-center text-[11px] text-muted-foreground">Agenda atualizada às {hour(new Date(data.updated_at))}</p>}
    </div>
  );
}

function Team({ team, right }: { team: GameTeam; right?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", right && "flex-row-reverse text-right")}>
      <div className="grid h-9 w-9 shrink-0 place-items-center">
        {team.logo ? <img src={team.logo} alt="" loading="lazy" className="h-9 w-9 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} /> : <Trophy className="h-4 w-4 text-muted-foreground" />}
      </div>
      <span className="truncate text-sm font-semibold">{team.name}</span>
    </div>
  );
}

function GameCard({ game: g, onPlay, currentId }: { game: Game; onPlay: (c: Channel, list: Channel[]) => void; currentId?: string }) {
  const live = g.state === "in";
  const missing = g.broadcasts.filter((b) => !g.channels.some((c) => c.broadcast === b));
  return (
    <li className={cn("rounded-2xl border bg-card p-3", live && "border-destructive/50")}>
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate font-semibold uppercase tracking-wide">{g.league}</span>
        <span className="ml-auto shrink-0">
          {live ? (
            <span className="inline-flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 font-bold text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> AO VIVO{g.detail ? ` · ${g.detail}` : ""}
            </span>
          ) : (
            <span className="font-bold text-foreground">{hour(new Date(g.start))}</span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Team team={g.home} />
        <span className="shrink-0 px-1 text-sm font-bold tabular-nums">{live ? `${g.home.score || 0} x ${g.away.score || 0}` : "x"}</span>
        <Team team={g.away} right />
      </div>
      {!!g.channels.length && (
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
      )}
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
          {g.guessed && " (canal provável)"}
        </p>
      )}
    </li>
  );
}
