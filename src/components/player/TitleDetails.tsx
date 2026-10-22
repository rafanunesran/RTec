import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Film, Heart, Play, RotateCcw, Sparkles, Star } from "lucide-react";
import { api, type Channel, type TitleInfo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, Skeleton } from "@/components/ui";
import { WATCHED_AT, fraction, getProgress, saveProgress } from "@/lib/progress";
import { tvNavigationOn, tvScreenOn } from "@/lib/tvnav";

const cache = new Map<string, TitleInfo | null>();

/** Busca (uma vez por sessao) a ficha do titulo: sinopse, elenco, direcao, generos... */
export function useTitleInfo(kind: "movie" | "series", id: string | undefined, name: string, year?: number) {
  const key = `${kind}|${id || ""}|${name}`;
  const [info, setInfo] = useState<TitleInfo | null | undefined>(() => cache.get(key));
  useEffect(() => {
    if (cache.has(key)) return setInfo(cache.get(key));
    setInfo(undefined);
    let alive = true;
    const q = new URLSearchParams({ kind, name, ...(id ? { id } : {}), ...(year ? { year: String(year) } : {}) });
    api
      .get<TitleInfo>(`/api/player/info?${q}`)
      .then((r) => {
        cache.set(key, r);
        if (alive) setInfo(r);
      })
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [key, kind, id, name, year]);
  return info; // undefined = carregando, null = sem ficha
}

const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}min` : ""}` : `${min}min`);
const hideBroken = (e: { currentTarget: HTMLImageElement }) => (e.currentTarget.style.display = "none");

/** Cabecalho com capa, dados e sinopse; usado na tela do filme e no topo da serie. */
export function TitleHeader({ kind, info, name, logo, actions }: { kind: "movie" | "series"; info: TitleInfo | null | undefined; name: string; logo: string; actions?: ReactNode }) {
  const [more, setMore] = useState(false);
  const poster = info?.poster || logo;
  const meta = [
    info?.year ? String(info.year) : "",
    info?.minutes ? duration(info.minutes) : "",
    kind === "series" && info?.seasons ? `${info.seasons} temporada${info.seasons > 1 ? "s" : ""}` : "",
    info?.age || "",
    info?.country || "",
  ].filter(Boolean);
  const people = (label: string, list?: string[]) =>
    !!list?.length && (
      <div className="text-sm">
        <span className="text-muted-foreground">{label}: </span>
        <span className="font-medium">{list.join(", ")}</span>
      </div>
    );

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card">
      {(info?.backdrop || poster) && (
        <div className="absolute inset-0">
          <img
            src={info?.backdrop || poster}
            alt=""
            className={cn("h-full w-full object-cover", info?.backdrop ? "opacity-35" : "scale-110 opacity-25 blur-2xl")}
            onError={hideBroken}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/85 to-card/40" />
        </div>
      )}
      <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:p-6">
        {poster && (
          <img src={poster} alt="" className="mx-auto aspect-[2/3] w-32 shrink-0 rounded-xl object-cover shadow-lg ring-1 ring-border sm:mx-0 sm:w-40" onError={hideBroken} />
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{info?.name || name}</h2>
            {info?.original_name && info.original_name !== info.name && <div className="text-sm text-muted-foreground">{info.original_name}</div>}
            {info?.tagline && <div className="mt-1 text-sm italic text-muted-foreground">{info.tagline}</div>}
          </div>
          {(meta.length > 0 || !!info?.rating) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {!!info?.rating && (
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <Star className="h-4 w-4 fill-warning text-warning" /> {info.rating.toFixed(1)}
                </span>
              )}
              {meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          )}
          {!!info?.genres?.length && (
            <div className="flex flex-wrap gap-1.5">
              {info.genres.map((g) => (
                <span key={g} className="rounded-full border bg-background/60 px-2.5 py-0.5 text-xs font-medium">
                  {g}
                </span>
              ))}
            </div>
          )}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          {info === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : info?.plot ? (
            <button type="button" onClick={() => setMore((m) => !m)} className="block text-left">
              <p className={cn("text-sm leading-relaxed", !more && "line-clamp-4")}>{info.plot}</p>
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">Sem sinopse disponível.</p>
          )}
          {people(kind === "series" ? "Criação" : "Direção", info?.director)}
          {people("Elenco", info?.cast)}
          <div className="flex flex-wrap items-center gap-3">
            {info?.trailer && (
              <Button variant="outline" size="sm" onClick={() => window.open(info.trailer, "_blank", "noopener")}>
                <Film /> Trailer
              </Button>
            )}
            {info?.source && (
              <span className="text-xs text-muted-foreground">
                Informações complementares:{" "}
                {info.link ? (
                  <a href={info.link} target="_blank" rel="noreferrer" className="underline">
                    {info.source}
                  </a>
                ) : (
                  info.source
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const recCache = new Map<string, Channel[]>();

/** Titulos semelhantes do catalogo do cliente (genero, direcao, elenco, ano e nota; a conta e no servidor). */
export function Recommendations({
  kind,
  id,
  name,
  year,
  skip,
  onOpen,
}: {
  kind: "movie" | "series";
  id: string | undefined;
  name: string;
  year?: number;
  skip?: string;
  onOpen: (c: Channel) => void;
}) {
  const key = `${kind}|${id || ""}|${skip || ""}`;
  const [items, setItems] = useState<Channel[] | undefined>(() => recCache.get(key));
  useEffect(() => {
    if (!id) return setItems([]);
    if (recCache.has(key)) return setItems(recCache.get(key));
    setItems(undefined);
    let alive = true;
    const q = new URLSearchParams({ kind, id, name, ...(year ? { year: String(year) } : {}), ...(skip ? { skip } : {}) });
    api
      .get<Channel[]>(`/api/player/recommend?${q}`)
      .then((r) => {
        recCache.set(key, r);
        if (alive) setItems(r);
      })
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [key, kind, id, name, year, skip]);

  if (items && !items.length) return null;
  return (
    <section className="space-y-2 pt-2">
      <div className="px-1">
        <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
          <Sparkles className="h-4 w-4 text-primary" /> {kind === "series" ? "Séries semelhantes" : "Filmes semelhantes"}
        </h3>
        <p className="text-xs text-muted-foreground">Pelo gênero, direção, elenco, ano e nota deste título.</p>
      </div>
      <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:-mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {items === undefined
          ? Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="w-28 shrink-0 sm:w-36">
                <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                <Skeleton className="mt-2 h-3 w-4/5" />
              </div>
            ))
          : items.map((c) => (
              <button key={c.id} type="button" onClick={() => onOpen(c)} className="group w-28 shrink-0 snap-start text-left sm:w-36">
                <div className="relative flex aspect-[2/3] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-secondary to-card ring-1 ring-border transition-all group-hover:-translate-y-1 group-hover:ring-primary/50">
                  {c.logo ? (
                    <img src={c.logo} alt="" loading="lazy" className="h-full w-full object-cover" onError={hideBroken} />
                  ) : (
                    <Film className="h-6 w-6 text-muted-foreground" />
                  )}
                  {!!c.rating && (
                    <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-background/85 px-1.5 py-0.5 text-[11px] font-semibold">
                      <Star className="h-3 w-3 fill-warning text-warning" /> {c.rating.toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="mt-2 line-clamp-2 text-xs font-semibold">{c.name}</div>
                <div className="line-clamp-1 text-[11px] text-muted-foreground">{c.reasons?.[0] || (c.year ? String(c.year) : "")}</div>
              </button>
            ))}
      </div>
    </section>
  );
}

/** Tela do filme: ficha completa + Assistir/Continuar. */
export function MovieDetails({
  movie,
  favorite,
  onFavorite,
  onPlay,
  onClose,
  onOpen,
  skip,
}: {
  movie: Channel;
  favorite: boolean;
  onFavorite: () => void;
  onPlay: () => void;
  onClose: () => void;
  onOpen: (c: Channel) => void;
  skip?: string;
}) {
  const info = useTitleInfo("movie", movie.xt_id, movie.name, movie.year);
  const f = fraction(movie);
  const started = f > 0 && f < WATCHED_AT;
  const left = (() => {
    const pr = getProgress(movie);
    return pr && started ? Math.max(1, Math.round((pr.d - pr.p) / 60)) : 0;
  })();
  // Controle remoto: a ficha ja abre com "Assistir" selecionado.
  const playRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (tvNavigationOn()) playRef.current?.focus();
  }, [movie.id]);
  const tv = tvScreenOn();

  return (
    <div data-tv-scope="40" className="fixed inset-0 z-40 overflow-y-auto bg-background">
      {tv && movie.logo && (
        // TV: o poster borrado de fundo, como nos apps de streaming.
        <img src={movie.logo} alt="" className="pointer-events-none fixed inset-0 h-full w-full scale-110 object-cover opacity-25 blur-3xl" onError={hideBroken} />
      )}
      <div className={cn("relative mx-auto space-y-3 p-3 pt-[max(12px,env(safe-area-inset-top))] sm:p-6", tv ? "max-w-6xl pt-10" : "max-w-4xl")}>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft /> Voltar
        </Button>
        <TitleHeader
          kind="movie"
          info={info}
          name={movie.name}
          logo={movie.logo}
          actions={
            <>
              <Button ref={playRef} variant="gradient" onClick={onPlay} className="relative overflow-hidden">
                <Play className="fill-current" /> {started ? "Continuar" : f >= WATCHED_AT ? "Assistir de novo" : "Assistir"}
                {started && <span className="absolute inset-x-0 bottom-0 h-1 bg-white/70" style={{ width: `${f * 100}%` }} />}
              </Button>
              {started && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const pr = getProgress(movie);
                    if (pr) saveProgress(movie, 0, pr.d);
                    onPlay();
                  }}
                >
                  <RotateCcw /> Do início
                </Button>
              )}
              <Button variant={favorite ? "secondary" : "outline"} onClick={onFavorite} aria-pressed={favorite}>
                <Heart className={cn(favorite && "fill-destructive text-destructive")} /> {favorite ? "Favorito" : "Favoritar"}
              </Button>
            </>
          }
        />
        {left > 0 && <p className="px-1 text-sm text-muted-foreground">Faltam cerca de {duration(left)} para terminar.</p>}
        {movie.group && <p className="px-1 text-xs text-muted-foreground">Categoria: {movie.group}</p>}
        <Recommendations kind="movie" id={movie.xt_id} name={movie.name} year={movie.year} skip={skip} onOpen={onOpen} />
      </div>
    </div>
  );
}
