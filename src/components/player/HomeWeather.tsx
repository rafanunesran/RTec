import { useEffect, useState, type ComponentType } from "react";
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Droplets, MapPin, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Faixa do topo do Inicio: relogio, tempo agora e previsao dos proximos dias.
 * Clima do Open-Meteo (sem chave), pedido direto do aparelho: nao passa pelo servidor nem pelo Firestore.
 * Local: GPS no celular (quando a pessoa permite), senao o local aproximado pelo IP (/api/geo, cabecalhos da Vercel).
 */

type Geo = { lat: number; lon: number; city?: string; gps?: boolean };
type Weather = {
  temp: number;
  feels: number;
  code: number;
  day: boolean;
  humidity: number;
  days: { date: string; code: number; max: number; min: number; rain: number }[];
};

const GEO_KEY = "rtec.geo";
const WX_KEY = "rtec.weather";
const GEO_TTL = 6 * 3600_000;
const WX_TTL = 30 * 60_000;
const NO_GPS_KEY = "rtec.geo.nogps";

const read = <T,>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sem armazenamento: so nao guarda */
  }
};

/** Codigos de tempo da OMS (usados pelo Open-Meteo) em texto e icone. */
export function describe(code: number, day = true): { label: string; Icon: ComponentType<{ className?: string }> } {
  if (code === 0) return { label: day ? "Céu limpo" : "Noite limpa", Icon: day ? Sun : Moon };
  if (code === 1) return { label: "Poucas nuvens", Icon: day ? CloudSun : CloudMoon };
  if (code === 2) return { label: "Parcialmente nublado", Icon: day ? CloudSun : CloudMoon };
  if (code === 3) return { label: "Nublado", Icon: Cloud };
  if (code === 45 || code === 48) return { label: "Neblina", Icon: CloudFog };
  if (code >= 51 && code <= 57) return { label: "Garoa", Icon: CloudDrizzle };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: code === 65 || code === 82 ? "Chuva forte" : "Chuva", Icon: CloudRain };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: "Neve", Icon: CloudSnow };
  if (code >= 95) return { label: "Tempestade", Icon: CloudLightning };
  return { label: "—", Icon: Cloud };
}

async function ipGeo(): Promise<Geo | null> {
  try {
    const r = await fetch("/api/geo");
    const j = (await r.json()) as Partial<Geo>;
    return typeof j.lat === "number" && typeof j.lon === "number" ? { lat: j.lat, lon: j.lon, city: j.city } : null;
  } catch {
    return null;
  }
}

function gpsGeo(): Promise<Geo | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const done = (g: Geo | null) => resolve(g);
    const t = setTimeout(() => done(null), 10_000);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        clearTimeout(t);
        const lat = +p.coords.latitude.toFixed(3);
        const lon = +p.coords.longitude.toFixed(3);
        let city: string | undefined;
        try {
          const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pt`);
          const j = await r.json();
          city = j.city || j.locality || undefined;
        } catch {
          /* fica sem o nome da cidade */
        }
        done({ lat, lon, city, gps: true });
      },
      (e) => {
        clearTimeout(t);
        if (e.code === e.PERMISSION_DENIED) write(NO_GPS_KEY, 1);
        done(null);
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 3600_000 },
    );
  });
}

async function fetchWeather(g: Geo): Promise<Weather> {
  const q = new URLSearchParams({
    latitude: String(g.lat),
    longitude: String(g.lon),
    current: "temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "6",
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!r.ok) throw new Error(`clima ${r.status}`);
  const j = await r.json();
  const d = j.daily;
  return {
    temp: j.current.temperature_2m,
    feels: j.current.apparent_temperature,
    code: j.current.weather_code,
    day: !!j.current.is_day,
    humidity: j.current.relative_humidity_2m,
    days: (d.time as string[]).map((date, i) => ({
      date,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      rain: d.precipitation_probability_max?.[i] ?? 0,
    })),
  };
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50); // vira junto com o minuto
    };
    t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(t);
  }, []);
  return now;
}

function useWeather(tv: boolean) {
  const cachedGeo = read<Geo & { at: number }>(GEO_KEY);
  const cachedWx = read<{ at: number; lat: number; lon: number; data: Weather }>(WX_KEY);
  const [geo, setGeo] = useState<Geo | null>(cachedGeo);
  const [wx, setWx] = useState<Weather | null>(cachedWx?.data ?? null);
  const [failed, setFailed] = useState(false);

  // Local: o guardado vale 6 h; no celular tenta o GPS (melhor que o IP), sem perguntar de novo se a pessoa recusou.
  useEffect(() => {
    let off = false;
    (async () => {
      const fresh = cachedGeo && Date.now() - cachedGeo.at < GEO_TTL;
      if (fresh && (cachedGeo.gps || tv)) return;
      if (!fresh) {
        const ip = await ipGeo();
        if (off) return;
        if (ip) {
          setGeo(ip);
          write(GEO_KEY, { ...ip, at: Date.now() });
        } else if (!cachedGeo) setFailed(true);
      }
      if (tv || read(NO_GPS_KEY)) return;
      const gps = await gpsGeo();
      if (off || !gps) return;
      setFailed(false);
      setGeo(gps);
      write(GEO_KEY, { ...gps, at: Date.now() });
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv]);

  // Tempo: guardado por 30 min e atualizado a cada 30 min com a tela aberta.
  useEffect(() => {
    if (!geo) return;
    let off = false;
    const load = async (force: boolean) => {
      const c = read<{ at: number; lat: number; lon: number; data: Weather }>(WX_KEY);
      const near = c && Math.abs(c.lat - geo.lat) < 0.05 && Math.abs(c.lon - geo.lon) < 0.05;
      if (!force && near && Date.now() - c.at < WX_TTL) return setWx(c.data);
      try {
        const data = await fetchWeather(geo);
        if (off) return;
        setWx(data);
        write(WX_KEY, { at: Date.now(), lat: geo.lat, lon: geo.lon, data });
      } catch {
        if (!off && !near) setFailed(true);
      }
    };
    void load(false);
    const t = setInterval(() => void load(true), WX_TTL);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [geo?.lat, geo?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  return { geo, wx, failed };
}

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const dayName = (iso: string, i: number) => (i === 0 ? "Hoje" : WEEKDAY.format(new Date(`${iso}T12:00:00`)).replace(".", ""));
const deg = (n: number) => `${Math.round(n)}°`;

export default function HomeWeather({ tv }: { tv: boolean }) {
  const now = useNow();
  const { geo, wx, failed } = useWeather(tv);
  const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }).replace(/^./, (c) => c.toUpperCase());
  const cur = wx ? describe(wx.code, wx.day) : null;
  const today = wx?.days[0];
  const next = wx?.days.slice(1, 6) ?? [];

  // Celular e tablet: faixa fina (~10% da tela), so relogio e tempo agora. TV e tela grande: ~20%, com a previsao dos proximos dias.
  const big = tv;
  return (
    <section
      aria-label="Relógio e previsão do tempo"
      className={cn(
        "relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/20 via-card to-card shadow-sm",
        "min-h-[10vh] px-4 py-2 lg:min-h-[20vh] lg:justify-start lg:gap-6 lg:p-5",
        big && "!h-[20vh] !min-h-0 !justify-start !gap-10 !px-10 !py-4",
      )}
    >
      {/* Relogio */}
      <div className="min-w-0 shrink-0">
        <div className={cn("font-bold leading-none tracking-tight tabular-nums", big ? "text-6xl" : "text-3xl sm:text-4xl lg:text-6xl")}>{time}</div>
        <div className={cn("mt-1 truncate text-muted-foreground", big ? "text-xl" : "text-xs sm:text-sm")}>{date}</div>
      </div>

      {/* Tempo agora */}
      {cur && wx ? (
        <div className={cn("flex min-w-0 items-center gap-2 sm:gap-3 lg:border-l lg:pl-6", big && "shrink-0 border-l pl-10")}>
          <cur.Icon className={cn("shrink-0 text-primary", big ? "h-16 w-16" : "h-9 w-9 sm:h-10 sm:w-10 lg:h-14 lg:w-14")} />
          <div className="min-w-0 text-right lg:text-left">
            <div className="flex items-baseline justify-end gap-2 lg:block">
              <span className={cn("font-bold leading-none tabular-nums", big ? "text-5xl" : "text-3xl sm:text-4xl lg:text-5xl")}>{deg(wx.temp)}</span>
              {today && (
                <span className={cn("tabular-nums text-muted-foreground lg:hidden", big && "hidden")}>
                  <span className="text-xs sm:text-sm">
                    ↑{deg(today.max)} ↓{deg(today.min)}
                  </span>
                </span>
              )}
            </div>
            <div className={cn("mt-0.5 truncate font-medium", big ? "text-lg" : "text-xs sm:text-sm")}>
              {cur.label}
              {geo?.city && <span className={cn("font-normal text-muted-foreground lg:hidden", big && "hidden")}> · {geo.city}</span>}
            </div>
            {today && (
              <div className={cn("hidden truncate text-muted-foreground lg:block", big ? "block text-base" : "text-xs")}>
                <span className="tabular-nums">
                  ↑{deg(today.max)} ↓{deg(today.min)}
                </span>{" "}
                · Sensação {deg(wx.feels)}
              </div>
            )}
            {geo?.city && (
              <div className={cn("mt-0.5 hidden items-center gap-1 truncate text-muted-foreground lg:flex", big ? "flex text-base" : "text-xs")}>
                <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{geo.city}</span>
              </div>
            )}
          </div>
        </div>
      ) : !failed ? (
        <div className="flex items-center gap-3 lg:border-l lg:pl-6">
          <div className={cn("animate-pulse rounded-full bg-muted", big ? "h-20 w-20" : "h-9 w-9 lg:h-12 lg:w-12")} />
          <div className="space-y-2">
            <div className="h-6 w-14 animate-pulse rounded bg-muted" />
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ) : null}

      {/* Proximos dias: so na TV e em tela grande */}
      {!!next.length && (
        <ul className={cn("ml-auto hidden gap-2 lg:flex", big && "flex gap-3")}>
          {next.map((d, i) => {
            const { label, Icon } = describe(d.code);
            return (
              <li key={d.date} title={label} className={cn("flex min-w-[72px] flex-col items-center rounded-xl bg-background/40 px-3 py-2 text-center", big && "min-w-[92px] py-2")}>
                <span className={cn("font-semibold capitalize text-muted-foreground", big ? "text-base" : "text-xs")}>{dayName(d.date, i + 1)}</span>
                <Icon className={cn("my-1 text-primary", big ? "h-7 w-7" : "h-6 w-6")} />
                <span className={cn("font-semibold tabular-nums", big ? "text-lg" : "text-sm")}>
                  {deg(d.max)} <span className="font-normal text-muted-foreground">{deg(d.min)}</span>
                </span>
                {d.rain >= 30 && (
                  <span className={cn("flex items-center gap-0.5 tabular-nums text-sky-400", big ? "text-sm" : "text-[10px]")}>
                    <Droplets className="h-3 w-3" />
                    {d.rain}%
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Protecao de tela: relogio, temperatura e icone do tempo no canto inferior direito (12% da altura da tela). */
export function SaverWeather() {
  const now = useNow();
  const { wx } = useWeather(true); // sem pedir GPS na protecao de tela: usa o local ja guardado ou o do IP
  const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const cur = wx ? describe(wx.code, wx.day) : null;
  return (
    <div className="saver-clock pointer-events-none absolute bottom-[5vh] right-[4vw] z-10 portrait:bottom-[24vh] flex h-[12vh] max-w-[92vw] items-center gap-[min(2.2vh,3vw)] rounded-[2vh] bg-black/35 px-[min(2.6vh,4vw)] text-white shadow-2xl backdrop-blur-md">
      <span className="text-[min(7.2vh,10vw)] font-bold leading-none tracking-tight tabular-nums drop-shadow-lg">{time}</span>
      {cur && wx && (
        <>
          <span className="h-[6.5vh] w-px bg-white/30" />
          <cur.Icon className="h-[min(6.5vh,9vw)] w-[min(6.5vh,9vw)] shrink-0 text-white drop-shadow-lg" />
          <span className="text-[min(5.6vh,8vw)] font-semibold leading-none tabular-nums drop-shadow-lg">{deg(wx.temp)}</span>
        </>
      )}
    </div>
  );
}
