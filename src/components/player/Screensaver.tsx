import { useEffect, useRef, useState } from "react";
import { api, type Channel, type TitleInfo } from "@/lib/api";
import { episodeInfo } from "@/lib/titlekey";

const IDLE_MS = 5 * 60 * 1000;
const SLIDE_MS = 12000;

/** Item da protecao de tela: de onde veio ("continuar" ou "indicacao") e como buscar a ficha. */
export type SaverItem = { from: "resume" | "rec"; kind: "movie" | "series"; id?: string; name: string; year?: number; logo: string };

type Slide = { key: number; item: SaverItem; image: string; blur: boolean; year: number; rating: number; age: string; name: string };

/** Canal/filme/episodio do catalogo -> titulo para a protecao de tela (episodio vira a serie dele). */
export function saverItem(c: Channel, from: SaverItem["from"]): SaverItem {
  if (c.kind === "movie") return { from, kind: "movie", id: c.xt_id, name: c.name, year: c.year, logo: c.logo };
  if (c.series_id) return { from, kind: "series", id: c.series_id, name: c.name, year: c.year, logo: c.logo };
  if (c.parent_series) return { from, kind: "series", id: c.parent_series, name: c.group, logo: c.logo };
  return { from, kind: "series", name: c.id.startsWith("serie:") ? c.name : episodeInfo(c.name).series, logo: c.logo };
}

const infoCache = new Map<string, Promise<TitleInfo | null>>();
function titleInfo(it: SaverItem) {
  const key = `${it.kind}|${it.id || ""}|${it.name}`;
  if (!infoCache.has(key)) {
    const q = new URLSearchParams({ kind: it.kind, name: it.name, ...(it.id ? { id: it.id } : {}), ...(it.year ? { year: String(it.year) } : {}) });
    infoCache.set(key, api.get<TitleInfo>(`/api/player/info?${q}`).catch(() => null));
  }
  return infoCache.get(key)!;
}

/** "16+", "16 anos", "Livre" -> "16", "L"; o resto (PG-13, TV-MA...) fica como veio. */
function ageLabel(age?: string) {
  const a = String(age || "").trim().replace(/\s*(\+|anos)$/i, "");
  if (/^(l|livre|al|er)$/i.test(a)) return "L";
  return /^0+$/.test(a) ? "" : a.slice(0, 8);
}

// Cores da classificacao indicativa brasileira.
const AGE_COLOR: Record<string, string> = { L: "#0c9447", "10": "#0f7dc2", "12": "#f8c411", "14": "#e67824", "16": "#db2827", "18": "#1d1815" };

function AgeBadge({ age }: { age: string }) {
  const bg = AGE_COLOR[age];
  return (
    <span
      className="inline-flex min-w-[1.9em] items-center justify-center rounded-[0.3em] px-[0.35em] py-[0.05em] text-[0.85em] font-extrabold leading-tight"
      style={bg ? { background: bg, color: age === "12" ? "#000" : "#fff", boxShadow: age === "18" ? "inset 0 0 0 1.5px #fff6" : undefined } : { boxShadow: "inset 0 0 0 2px #ffffffb3" }}
    >
      {age}
    </span>
  );
}

function preload(src: string) {
  return new Promise<boolean>((ok) => {
    const img = new Image();
    const t = setTimeout(() => ok(false), 10000);
    img.onload = () => (clearTimeout(t), ok(true));
    img.onerror = () => (clearTimeout(t), ok(false));
    img.src = src;
  });
}

/** Ordem: a cada 3 do "Continuar assistindo", 1 indicacao (o que faltar de um lado e completado pelo outro). */
function* order(resume: SaverItem[], recs: SaverItem[]) {
  let r = 0;
  let i = 0;
  while (resume.length || recs.length) {
    for (let k = 0; k < 3 && resume.length; k++) yield resume[r++ % resume.length];
    if (recs.length) yield recs[i++ % recs.length];
  }
}

/**
 * Protecao de tela: depois de 5 min sem tocar em nada (e sem video aberto), passa as imagens de fundo
 * dos titulos com o nome no canto inferior esquerdo e o ano e a nota embaixo. Qualquer tecla ou toque sai.
 */
export default function Screensaver({ enabled, resume, loadRecs }: { enabled: boolean; resume: SaverItem[]; loadRecs: () => Promise<SaverItem[]> }) {
  const [active, setActive] = useState(false);
  const last = useRef(Date.now());
  const idleMs = useRef(Number(new URLSearchParams(location.search).get("protecao")) * 1000 || IDLE_MS); // ?protecao=10 para testar

  // Conta o tempo sem interacao.
  useEffect(() => {
    if (!enabled) return setActive(false);
    last.current = Date.now();
    let from: { x: number; y: number } | null = null;
    const bump = () => (last.current = Date.now());
    const onMove = (e: PointerEvent) => {
      // Alguns controles de TV mandam "movimentos" parados: so conta se o ponteiro andar de verdade.
      if (from && Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) < 12) return;
      from = { x: e.clientX, y: e.clientY };
      bump();
    };
    const evs = ["keydown", "pointerdown", "wheel", "touchstart", "scroll"] as const;
    evs.forEach((ev) => window.addEventListener(ev, bump, { capture: true, passive: true }));
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });
    const timer = setInterval(() => {
      if (Date.now() - last.current >= idleMs.current) setActive(true);
    }, 5000);
    return () => {
      evs.forEach((ev) => window.removeEventListener(ev, bump, { capture: true }));
      window.removeEventListener("pointermove", onMove, { capture: true });
      clearInterval(timer);
    };
  }, [enabled]);

  if (!active) return null;
  return (
    <Saver
      resume={resume}
      loadRecs={loadRecs}
      onExit={() => {
        last.current = Date.now();
        setActive(false);
      }}
    />
  );
}

function Saver({ resume, loadRecs, onExit }: { resume: SaverItem[]; loadRecs: () => Promise<SaverItem[]>; onExit: () => void }) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [empty, setEmpty] = useState(false);
  const src = useRef({ resume, loadRecs }); // fixos enquanto a protecao estiver na tela

  // Sai com qualquer tecla (inclusive Voltar do controle) sem a tecla fazer mais nada na tela de baixo.
  useEffect(() => {
    let from: { x: number; y: number } | null = null;
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      swallow(e);
      onExit();
    };
    const onMove = (e: PointerEvent) => {
      if (!from) from = { x: e.clientX, y: e.clientY };
      else if (Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) > 24) onExit();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", swallow, true);
    window.addEventListener("pointermove", onMove, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", swallow, true);
      window.removeEventListener("pointermove", onMove, true);
    };
  }, [onExit]);

  useEffect(() => {
    let alive = true;
    let key = 0;
    let timer = 0;
    (async () => {
      const { resume, loadRecs } = src.current;
      const recs = await loadRecs().catch(() => [] as SaverItem[]);
      if (!alive) return;
      const seq = order(resume, recs);
      const total = resume.length + recs.length;
      let misses = 0;
      const nextSlide = async (): Promise<Slide | null> => {
        while (alive && misses < Math.max(total, 1) * 2) {
          const { value: item } = seq.next();
          if (!item) return null;
          const info = await titleInfo(item);
          const image = info?.backdrop || info?.poster || item.logo;
          if (image && (await preload(image))) {
            misses = 0;
            return { key: ++key, item, image, blur: !info?.backdrop, name: info?.name || item.name, year: info?.year || item.year || 0, rating: info?.rating || 0, age: ageLabel(info?.age) };
          }
          misses++;
        }
        return null;
      };
      let upcoming = nextSlide();
      const show = async () => {
        const s = await upcoming;
        if (!alive) return;
        if (!s) {
          if (!key) setEmpty(true);
          else timer = window.setTimeout(show, SLIDE_MS); // ja mostrou algo: tenta de novo depois
          return;
        }
        setSlides((cur) => [...cur.slice(-1), s]);
        upcoming = nextSlide();
        timer = window.setTimeout(show, SLIDE_MS);
      };
      show();
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="saver fixed inset-0 z-[200] cursor-none overflow-hidden bg-black text-white" onClick={onExit} role="presentation">
      {slides.map((s, i) => (
        <div key={s.key} className={i === slides.length - 1 ? "saver-in absolute inset-0" : "absolute inset-0"}>
          {s.blur ? (
            <>
              <img src={s.image} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
              <div className="absolute inset-y-0 right-[8%] flex items-center">
                <img src={s.image} alt="" className="saver-zoom h-[70vh] rounded-2xl object-contain shadow-2xl" />
              </div>
            </>
          ) : (
            <img src={s.image} alt="" className="saver-zoom absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-transparent to-transparent" />
          <div className="absolute bottom-[8%] left-[5%] max-w-[60%]">
            <div className="mb-[0.6em] text-[clamp(0.75rem,1.1vw,1.25rem)] font-semibold uppercase tracking-[0.2em] text-white/70">
              {s.item.from === "resume" ? "Continuar assistindo" : "Indicação para você"}
            </div>
            <div className="line-clamp-2 text-[clamp(1.75rem,4.2vw,5rem)] font-extrabold leading-[1.05] tracking-tight drop-shadow-lg">{s.name}</div>
            {(!!s.year || !!s.rating || !!s.age) && (
              <div className="mt-[0.5em] flex items-center gap-[0.8em] text-[clamp(1rem,1.7vw,2rem)] font-semibold text-white/85">
                {[
                  s.year ? <span key="y">{s.year}</span> : null,
                  s.rating ? (
                    <span key="r">
                      <span className="text-amber-400">★</span> {s.rating.toFixed(1)}
                    </span>
                  ) : null,
                  s.age ? <AgeBadge key="a" age={s.age} /> : null,
                ]
                  .filter(Boolean)
                  .flatMap((el, i) => (i ? [<span key={`d${i}`} className="text-white/40">•</span>, el] : [el]))}
              </div>
            )}
          </div>
        </div>
      ))}
      {empty && !slides.length && <div className="absolute inset-0 grid place-items-center text-white/40">RTec</div>}
    </div>
  );
}
