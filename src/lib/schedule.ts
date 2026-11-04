import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Calendario da temporada em lancamento (servidor: server/schedule.js, dados do TMDB ou TVmaze).
// A pagina da serie usa para mostrar quantos episodios a temporada tera e a data de cada um que falta.

export type ScheduledEpisode = { episode: number; name: string; date: string; at: string };
export type ScheduledSeason = { season: number; total: number; episodes: ScheduledEpisode[] };
export type Schedule = { seasons: ScheduledSeason[]; source: string };

const cache = new Map<string, Schedule>();

export function useSchedule(id: string | undefined, name: string) {
  const key = `${id || ""}|${name}`;
  const [data, setData] = useState<Schedule | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    if (cache.has(key)) return setData(cache.get(key)!);
    setData(null);
    let alive = true;
    const q = new URLSearchParams({ name, ...(id ? { id } : {}) });
    api
      .get<Schedule>(`/api/player/schedule?${q}`)
      .then((r) => {
        const s = { seasons: Array.isArray(r?.seasons) ? r.seasons : [], source: r?.source || "" };
        cache.set(key, s);
        if (alive) setData(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, id, name]);
  return data;
}

/** Momento em que o episodio sai: com hora (TVmaze) ou fim do dia da data (TMDB so tem o dia). */
export function airTime(e: ScheduledEpisode) {
  if (e.at) return Date.parse(e.at);
  if (e.date) return new Date(`${e.date}T23:59:59`).getTime();
  return NaN;
}

const DAY = 86400000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Estreia hoje às 22:00", "Estreia qua., 12/11", "Lançado em 05/11 · ainda não está na lista". */
export function airLabel(e: ScheduledEpisode, now = Date.now()) {
  if (!e.date) return { released: false, text: "Data ainda não divulgada" };
  const t = e.at ? Date.parse(e.at) : new Date(`${e.date}T12:00:00`).getTime();
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const day = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", ...(sameYear ? {} : { year: "numeric" }) });
  const hour = e.at ? ` às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
  if (airTime(e) <= now) return { released: true, text: `Lançado em ${day} · ainda não está na lista` };
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  const when = diff === 0 ? "hoje" : diff === 1 ? "amanhã" : `${d.toLocaleDateString("pt-BR", { weekday: "short" })}, ${day}`;
  return { released: false, text: `Estreia ${when}${hour}` };
}
