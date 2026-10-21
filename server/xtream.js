// Cliente da API Xtream Codes (player_api.php), usada por XUI.One, OneStream e a maioria dos paineis IPTV.
// Carrega o catalogo por categoria, em pedacos pequenos, em vez de baixar a lista M3U inteira
// (que em fornecedores grandes passa de 70 MB e nao cabe numa resposta da Vercel).

const PLAYER_UA = "VLC/3.0.20 LibVLC/3.0.20";
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

/** Extrai servidor/usuario/senha de uma fonte Xtream ou de um link get.php / player_api.php. */
export function xtreamCredentials(source) {
  if (!source) return null;
  if (source.kind === "xtream" && source.xtream_server && source.xtream_username && source.xtream_password) {
    return { server: source.xtream_server.replace(/\/+$/, ""), username: source.xtream_username, password: source.xtream_password };
  }
  if (source.kind === "m3u_url" && source.url) return parseXtreamLink(source.url);
  return null;
}

/** "http://srv:80/get.php?username=U&password=P&type=m3u_plus" -> { server, username, password } */
export function parseXtreamLink(link) {
  let url;
  try {
    url = new URL(String(link).trim());
  } catch {
    return null;
  }
  const username = url.searchParams.get("username");
  const password = url.searchParams.get("password");
  if (!/\/(get|player_api)\.php$/i.test(url.pathname) || !username || !password) return null;
  return { server: url.origin, username, password };
}

async function call(creds, params = {}) {
  const q = new URLSearchParams({ username: creds.username, password: creds.password, ...params });
  const url = `${creds.server}/player_api.php?${q}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": PLAYER_UA, Accept: "application/json" } });
  } catch (err) {
    throw new Error(err.name === "TimeoutError" ? "O servidor do fornecedor demorou demais" : "Nao foi possivel conectar no servidor do fornecedor");
  }
  if (!res.ok) throw new Error(`O fornecedor respondeu com erro HTTP ${res.status}`);
  const data = await res.json().catch(() => {
    throw new Error("O fornecedor nao respondeu no formato Xtream");
  });
  cache.set(url, { at: Date.now(), data });
  return data;
}

/** Login no fornecedor: status da conta, validade e limite de telas. */
export async function accountInfo(creds) {
  const data = await call(creds);
  const u = data?.user_info;
  if (!u || Number(u.auth) === 0) throw new Error("O fornecedor recusou o usuario/senha da lista");
  const exp = Number(u.exp_date);
  return {
    status: u.status || "",
    expires_at: exp > 0 ? new Date(exp * 1000).toISOString() : null,
    max_connections: Number(u.max_connections) || null,
  };
}

const SECTION_ACTIONS = {
  live: { categories: "get_live_categories", items: "get_live_streams" },
  movie: { categories: "get_vod_categories", items: "get_vod_streams" },
  series: { categories: "get_series_categories", items: "get_series" },
};

export async function categories(creds, section) {
  const list = await call(creds, { action: SECTION_ACTIONS[section].categories });
  return (Array.isArray(list) ? list : []).map((c) => ({ id: String(c.category_id), name: String(c.category_name || "").trim() }));
}

/** Ano de lancamento: campo year, data de lancamento ou "(2019)" no nome. */
function yearOf(it) {
  for (const v of [it.year, it.release_date, it.releaseDate, it.releasedate]) {
    const m = /(19|20)\d{2}/.exec(String(v ?? ""));
    if (m) return Number(m[0]);
  }
  const m = /\((19|20)\d{2}\)/.exec(String(it.name ?? ""));
  return m ? Number(m[0].slice(1, 5)) : 0;
}

/** Dados para ordenar: quando foi adicionado (s), ano e nota (0 a 10). */
function sortInfo(it) {
  const rating = Number(it.rating) || Number(it.rating_5based) * 2 || 0;
  return { added: Number(it.added) || Number(it.last_modified) || 0, year: yearOf(it), rating: Math.round(rating * 10) / 10, genre: String(it.genre || "").trim() };
}

/** Elenco e direcao quando a lista ja traz (get_series quase sempre; get_vod_streams as vezes). */
function metaInfo(it) {
  const out = {};
  const split = (v, re) => String(v || "").split(re).map((s) => s.trim()).filter(Boolean);
  const cast = split(it.cast || it.actors, /\s*,\s*/).slice(0, 12);
  const director = split(it.director, /\s*,\s*/);
  if (cast.length) out.cast = cast;
  if (director.length) out.director = director;
  return out;
}

const ext = (v, fallback) => (/^[a-z0-9]{2,5}$/i.test(String(v || "")) ? String(v).toLowerCase() : fallback);

/** Itens de uma categoria (ou todos os canais ao vivo, sem categoria) ja com o link do video. */
export async function items(creds, section, categoryId) {
  const params = { action: SECTION_ACTIONS[section].items };
  if (categoryId) params.category_id = categoryId;
  const list = await call(creds, params);
  const base = `${creds.server}/${section === "live" ? "live" : section === "movie" ? "movie" : "series"}/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}`;
  return (Array.isArray(list) ? list : []).map((it) => {
    if (section === "series") {
      return { kind: "series", series_id: String(it.series_id), name: it.name || it.title || "", logo: it.cover || "", category_id: String(it.category_id ?? ""), ...sortInfo(it), ...metaInfo(it) };
    }
    if (section === "movie") {
      return {
        kind: "movie",
        stream_id: String(it.stream_id),
        name: it.name || it.title || "",
        logo: it.stream_icon || "",
        url: `${base}/${it.stream_id}.${ext(it.container_extension, "mp4")}`,
        category_id: String(it.category_id ?? ""),
        ...sortInfo(it),
        ...metaInfo(it),
      };
    }
    return {
      kind: "live",
      stream_id: String(it.stream_id),
      name: it.name || "",
      logo: it.stream_icon || "",
      url: `${base}/${it.stream_id}.ts`,
      alt_url: `${base}/${it.stream_id}.m3u8`,
      category_id: String(it.category_id ?? ""),
      added: Number(it.added) || 0,
    };
  });
}

/** Episodios de uma serie, em ordem de temporada e episodio. */
export async function seriesEpisodes(creds, seriesId) {
  const data = await call(creds, { action: "get_series_info", series_id: seriesId });
  const base = `${creds.server}/series/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}`;
  const out = [];
  for (const [season, eps] of Object.entries(data?.episodes || {})) {
    for (const ep of Array.isArray(eps) ? eps : []) {
      out.push({
        kind: "series",
        stream_id: String(ep.id),
        season: Number(ep.season ?? season) || 1,
        episode: Number(ep.episode_num) || 0,
        name: ep.title || `Episodio ${ep.episode_num}`,
        logo: ep.info?.movie_image || data?.info?.cover || "",
        url: `${base}/${ep.id}.${ext(ep.container_extension, "mp4")}`,
      });
    }
  }
  return out.sort((a, b) => a.season - b.season || a.episode - b.episode);
}

const b64 = (s) => {
  try {
    return Buffer.from(String(s || ""), "base64").toString("utf8");
  } catch {
    return "";
  }
};

/** Programacao curta (agora / a seguir) de um canal ao vivo. */
export async function shortEpg(creds, streamId) {
  const data = await call(creds, { action: "get_short_epg", stream_id: streamId, limit: "4" });
  return (data?.epg_listings || [])
    .map((p) => ({
      start: new Date(Number(p.start_timestamp) * 1000).toISOString(),
      stop: new Date(Number(p.stop_timestamp) * 1000).toISOString(),
      title: b64(p.title),
      desc: b64(p.description).slice(0, 400),
    }))
    .filter((p) => new Date(p.stop).getTime() > Date.now());
}

const strList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => String(s || "").trim()).filter(Boolean);
const trailerUrl = (v) => {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return /^[\w-]{6,20}$/.test(s) ? `https://www.youtube.com/watch?v=${s}` : "";
};
/** "01:52:10", "112 min", "6720" (s) -> minutos */
function minutes(info) {
  const secs = Number(info.duration_secs) || 0;
  if (secs > 0) return Math.round(secs / 60);
  const d = String(info.duration || info.episode_run_time || "").trim();
  const hms = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(d);
  if (hms) return hms[3] !== undefined ? Number(hms[1]) * 60 + Number(hms[2]) : Number(hms[1]);
  const n = parseFloat(d);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Ficha de um filme (get_vod_info) ou serie (get_series_info): sinopse, elenco, direcao, genero etc. */
export async function titleInfo(creds, kind, id) {
  const data = await call(creds, kind === "series" ? { action: "get_series_info", series_id: id } : { action: "get_vod_info", vod_id: id });
  const info = data?.info && typeof data.info === "object" && !Array.isArray(data.info) ? data.info : {};
  const rating = Number(info.rating) || Number(info.rating_5based) * 2 || 0;
  const seasons = kind === "series" ? Object.keys(data?.episodes || {}).length : 0;
  return {
    name: String(info.name || data?.movie_data?.name || "").trim(),
    original_name: String(info.o_name || info.original_name || "").trim(),
    plot: String(info.plot || info.description || "").trim(),
    genres: strList(String(info.genre || "").split(/\s*[,/|]\s*/)),
    cast: strList(String(info.cast || info.actors || "").split(/\s*,\s*/)).slice(0, 12),
    director: strList(String(info.director || "").split(/\s*,\s*/)),
    year: yearOf({ year: info.year, release_date: info.releasedate || info.release_date || info.releaseDate }),
    release_date: String(info.releasedate || info.release_date || info.releaseDate || "").trim(),
    rating: Math.round(rating * 10) / 10,
    minutes: minutes(info),
    country: String(info.country || "").trim(),
    age: String(info.age || info.mpaa_rating || "").trim(),
    poster: String(info.movie_image || info.cover_big || info.cover || "").trim(),
    backdrop: strList(info.backdrop_path)[0] || "",
    trailer: trailerUrl(info.youtube_trailer || info.trailer),
    tmdb_id: String(info.tmdb_id || info.tmdb || "").trim(),
    seasons,
  };
}
