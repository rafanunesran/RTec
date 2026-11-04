// Calendario da temporada em lancamento: quantos episodios ela tera e a data oficial de cada um.
// - TMDB (se TMDB_API_KEY estiver configurada), pelo codigo TMDB da serie.
// - Sem chave ou sem resultado: TVmaze (publica, sem chave), pelo nome da serie.
// So devolve temporadas "vivas": com episodio ainda por sair ou que saiu ha pouco (o aparelho mostra
// apenas os que ainda nao lancaram ou que ja lancaram mas nao estao na lista do cliente).

import { cleanTitle } from "./titleinfo.js";

const TTL_MS = 6 * 60 * 60 * 1000;
const RECENT_DAYS = 120;
const cache = new Map();
const TMDB = "https://api.themoviedb.org/3";
const TVMAZE = "https://api.tvmaze.com";
const UA = "RTecPlayer/1.0 (calendario de episodios)";

const fold = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isDate = (d) => /^\d{4}-\d{2}-\d{2}/.test(String(d || ""));

async function getJson(url, headers = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json", "User-Agent": UA, ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function tmdbFetch(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  const q = new URLSearchParams({ language: "pt-BR", ...params });
  if (key.length <= 40) q.set("api_key", key);
  return getJson(`${TMDB}${path}?${q}`, key.length > 40 ? { Authorization: `Bearer ${key}` } : {});
}

/**
 * Escolhe as temporadas em lancamento: a ultima e, se houver, a anterior que ainda tem episodio
 * futuro ou recente (ate 120 dias). Episodios sem data contam como "ainda vai sair".
 * seasons: [{ season, total, episodes: [{ episode, name, date, at }] }]
 */
export function liveSeasons(seasons, now = Date.now()) {
  const since = now - RECENT_DAYS * 86400000;
  const when = (e) => (e.at ? Date.parse(e.at) : isDate(e.date) ? Date.parse(`${e.date}T23:59:59Z`) : NaN);
  const live = (s) => s.episodes.some((e) => !(when(e) < since));
  return seasons
    .filter((s) => s.season > 0 && s.episodes.length)
    .sort((a, b) => a.season - b.season)
    .slice(-2)
    .filter(live)
    .map((s) => ({ ...s, total: Math.max(s.total || 0, s.episodes.length), episodes: [...s.episodes].sort((a, b) => a.episode - b.episode) }));
}

/** /tv/{id}/season/{n} do TMDB -> temporada no formato acima. */
export function tmdbSeason(d, count = 0) {
  const episodes = (d.episodes || [])
    .filter((e) => Number(e.episode_number) > 0)
    .map((e) => ({ episode: Number(e.episode_number), name: String(e.name || "").trim(), date: isDate(e.air_date) ? e.air_date.slice(0, 10) : "", at: "" }));
  return { season: Number(d.season_number) || 0, total: Math.max(Number(count) || 0, episodes.length), episodes };
}

/** Episodios do TVmaze (embed=episodes) -> temporadas. airstamp traz a hora (UTC). */
export function tvmazeSeasons(episodes) {
  const by = new Map();
  for (const e of episodes || []) {
    const season = Number(e.season) || 0;
    const episode = Number(e.number) || 0;
    if (!season || !episode || e.type === "insignificant_special") continue;
    if (!by.has(season)) by.set(season, []);
    by.get(season).push({ episode, name: /^TBA$/i.test(e.name || "") ? "" : String(e.name || "").trim(), date: isDate(e.airdate) ? e.airdate : "", at: e.airstamp && isDate(e.airdate) ? e.airstamp : "" });
  }
  return [...by].map(([season, list]) => ({ season, total: list.length, episodes: list }));
}

async function fromTmdb(tmdbId) {
  if (!process.env.TMDB_API_KEY || !/^\d+$/.test(String(tmdbId || ""))) return null;
  const d = await tmdbFetch(`/tv/${tmdbId}`);
  const cand = (d.seasons || []).filter((s) => s.season_number > 0).sort((a, b) => a.season_number - b.season_number).slice(-2);
  if (!cand.length) return null;
  const seasons = await Promise.all(cand.map((s) => tmdbFetch(`/tv/${tmdbId}/season/${s.season_number}`).then((x) => tmdbSeason(x, s.episode_count)).catch(() => null)));
  return { source: "TMDB", seasons: seasons.filter(Boolean) };
}

async function fromTvmaze(title, year) {
  const show = await getJson(`${TVMAZE}/singlesearch/shows?${new URLSearchParams({ q: title, embed: "episodes" })}`);
  if (!show?.id) return null;
  // Nome parecido e, se o ano for conhecido, estreia perto dele: evita mostrar o calendario de outra serie.
  const a = fold(title);
  const b = fold(show.name);
  if (!(a === b || (a.length > 3 && (b.startsWith(a) || a.startsWith(b))))) return null;
  const premiered = Number(String(show.premiered || "").slice(0, 4));
  if (year && premiered && Math.abs(premiered - year) > 1) return null;
  return { source: "TVmaze", seasons: tvmazeSeasons(show._embedded?.episodes) };
}

/** Calendario da(s) temporada(s) em lancamento. Nunca lanca erro: sem dados devolve { seasons: [] }. */
export async function seriesSchedule({ name, year = 0, tmdbId = "" }, now = Date.now()) {
  const empty = { seasons: [], source: "" };
  if (process.env.RTEC_NO_ONLINE_INFO === "1") return empty;
  const title = cleanTitle(name);
  if (!title && !tmdbId) return empty;
  const key = `${fold(title)}|${year || ""}|${tmdbId || ""}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.data;
  let data = null;
  try {
    data = await fromTmdb(tmdbId);
  } catch {
    data = null;
  }
  if (!data?.seasons?.length && title) data = await fromTvmaze(title, year).catch(() => null);
  const out = data ? { source: data.source, seasons: liveSeasons(data.seasons, now) } : empty;
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: now, data: out });
  return out;
}
