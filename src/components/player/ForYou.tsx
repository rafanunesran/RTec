import { useEffect, useState } from "react";
import { Check, Film, Settings2, Sparkles, Star } from "lucide-react";
import type { Channel } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, Dialog, Skeleton } from "@/components/ui";
import type { RecKind } from "@/lib/recprefs";

// Recomendacoes da primeira pagina de Filmes e Series: configuracao de generos (primeira vez)
// e as fileiras "Para voce" que aparecem antes da lista completa.

const ADULT = /(adult|xxx|\+18|18\+|adulto|er[oó]tic|hot\b|sexy|porn)/i;
const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const hideBroken = (e: { currentTarget: HTMLImageElement }) => (e.currentTarget.style.display = "none");
const noun = (k: RecKind) => (k === "series" ? "séries" : "filmes");

/** Popup "Monte suas recomendações": abre sozinho na primeira vez que a pessoa entra em Filmes ou Séries. */
export function RecSetupDialog({
  kind,
  initial,
  loadGenres,
  onSave,
  onSkip,
}: {
  kind: RecKind;
  initial: string[];
  loadGenres: () => Promise<{ name: string; count: number }[]>;
  onSave: (genres: string[]) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [genres, setGenres] = useState<{ name: string; count: number }[] | null>(null);
  useEffect(() => {
    loadGenres()
      .then((g) => setGenres(g.filter((x) => !ADULT.test(x.name))))
      .catch(() => setGenres([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const on = (g: string) => picked.some((x) => fold(x) === fold(g));
  const toggle = (g: string) => setPicked((p) => (on(g) ? p.filter((x) => fold(x) !== fold(g)) : [...p, g]));

  return (
    <Dialog
      open
      onClose={onSkip}
      title={`Monte suas recomendações de ${noun(kind)}`}
      description={`Escolha os gêneros que você mais gosta. A primeira página de ${kind === "series" ? "Séries" : "Filmes"} vai abrir com sugestões deles.`}
      icon={<Sparkles className="h-5 w-5" />}
    >
      <div className="space-y-5">
        {genres === null ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-24 rounded-full" />
            ))}
          </div>
        ) : !genres.length ? (
          <p className="text-sm text-muted-foreground">Esta lista não informa os gêneros, então as sugestões vêm do que você assistir.</p>
        ) : (
          <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto p-0.5">
            {genres.map((g) => (
              <button
                key={g.name}
                type="button"
                aria-pressed={on(g.name)}
                onClick={() => toggle(g.name)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                  on(g.name) ? "border-transparent bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {on(g.name) && <Check className="h-3.5 w-3.5" />}
                {g.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onSkip}>
            Agora não
          </Button>
          <Button variant="gradient" className="flex-1" onClick={() => onSave(picked)} disabled={!!genres?.length && !picked.length}>
            Salvar{picked.length ? ` (${picked.length})` : ""}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export type ForYouRow = { key: string; title: string; sub?: string; load: () => Promise<Channel[]> };

const rowCache = new Map<string, Channel[]>();

function Row({ row, onOpen }: { row: ForYouRow; onOpen: (c: Channel) => void }) {
  const [items, setItems] = useState<Channel[] | undefined>(() => rowCache.get(row.key));
  useEffect(() => {
    if (rowCache.has(row.key)) return setItems(rowCache.get(row.key));
    setItems(undefined);
    let alive = true;
    row
      .load()
      .then((r) => {
        rowCache.set(row.key, r);
        if (alive) setItems(r);
      })
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.key]);

  if (items && !items.length) return null;
  return (
    <section className="space-y-2">
      <div className="px-1">
        <h3 className="text-base font-bold tracking-tight">{row.title}</h3>
        {row.sub && <p className="text-xs text-muted-foreground">{row.sub}</p>}
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
                <div className="relative flex aspect-[2/3] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-b from-secondary to-card ring-1 ring-border transition-all group-hover:-translate-y-1 group-hover:ring-primary/50 group-focus-visible:ring-2 group-focus-visible:ring-primary">
                  {c.logo ? <img src={c.logo} alt="" loading="lazy" className="h-full w-full object-cover" onError={hideBroken} /> : <Film className="h-6 w-6 text-muted-foreground" />}
                  {!!c.rating && (
                    <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-background/85 px-1.5 py-0.5 text-[11px] font-semibold">
                      <Star className="h-3 w-3 fill-warning text-warning" /> {c.rating.toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="mt-2 line-clamp-2 text-xs font-semibold">{c.name}</div>
                <div className="line-clamp-1 text-[11px] text-muted-foreground">{c.year ? String(c.year) : ""}</div>
              </button>
            ))}
      </div>
    </section>
  );
}

/** "Para você": fileiras pelos generos escolhidos (e pelo ultimo assistido), antes da lista completa. */
export function ForYou({ kind, rows, configured, onOpen, onEdit }: { kind: RecKind; rows: ForYouRow[]; configured: boolean; onOpen: (c: Channel) => void; onEdit: () => void }) {
  return (
    <div className="mb-6 space-y-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" /> Para você
        </h2>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Settings2 /> {configured ? "Ajustar" : "Configurar"}
        </Button>
      </div>
      {!configured && (
        <button type="button" onClick={onEdit} className="w-full rounded-2xl border border-dashed p-4 text-left text-sm text-muted-foreground hover:bg-accent">
          Escolha seus gêneros favoritos para ver aqui {kind === "series" ? "séries escolhidas" : "filmes escolhidos"} para você.
        </button>
      )}
      {rows.map((r) => (
        <Row key={r.key} row={r} onOpen={onOpen} />
      ))}
      <h2 className="px-1 pt-2 text-lg font-bold tracking-tight">{kind === "series" ? "Todas as séries" : "Todos os filmes"}</h2>
    </div>
  );
}
