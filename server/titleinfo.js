// Completa a ficha de filmes/series com dados da internet quando o fornecedor nao manda tudo.
// - TMDB (themoviedb.org), se TMDB_API_KEY estiver configurada: sinopse, elenco, direcao, generos, capa, trailer.
// - Sem chave: resumo da Wikipedia em portugues (so a sinopse).
// O resultado fica em memoria por algumas horas para nao repetir a busca a cada clique.

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const UA = "RTecPlayer/1.0 (catalogo de filmes)";

const fold = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "BR: Abelha Rainha (2023) [4K] - Dublado" -> "Abelha Rainha" */
export function cleanTitle(name) {
  return String(name || "")
    .replace(/^\s*[A-Z]{2,3}\s*[:|-]\s+/, "")
    .replace(/\[[^\]]*\]|\{[^}]*\}/g, " ")
    .replace(/\((19|20)\d{2}\)/g, " ")
    .replace(/\b(19|20)\d{2}\s*$/, " ")
    .replace(/\s+[-|]\s*(dublado|legendado|dual|nacional|4k|fhd|hd|uhd|sd|h265|hevc)\b.*$/i, " ")
    .replace(/\b(dublado|legendado|dual [aá]udio|4k|fhd|uhd|h265|hevc)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json", "User-Agent": UA, ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function tmdbFetch(path, params = {}) {
  const key = process.env.TMDB_API_KEY;
  const q = new URLSearchParams({ language: "pt-BR", ...params });
  // Aceita a chave da API (v3) ou o token de leitura (v4, bem mais longo).
  if (key.length <= 40) q.set("api_key", key);
  return getJson(`${TMDB}${path}?${q}`, key.length > 40 ? { Authorization: `Bearer ${key}` } : {});
}

async function fromTmdb(kind, title, year, tmdbId) {
  const type = kind === "series" ? "tv" : "movie";
  let id = /^\d+$/.test(tmdbId || "") ? tmdbId : "";
  if (!id) {
    const params = { query: title, include_adult: "false" };
    if (year) params[type === "tv" ? "first_air_date_year" : "year"] = String(year);
    let found = (await tmdbFetch(`/search/${type}`, params)).results || [];
    if (!found.length && year) found = (await tmdbFetch(`/search/${type}`, { query: title })).results || [];
    if (!found.length) return null;
    id = String(found[0].id);
  }
  const d = await tmdbFetch(`/${type}/${id}`, { append_to_response: `credits,videos,${type === "tv" ? "content_ratings" : "release_dates"}`, include_video_language: "pt,en" });
  const video = (d.videos?.results || []).find((v) => v.site === "YouTube" && /trailer|teaser/i.test(v.type));
  const date = d.release_date || d.first_air_date || "";
  return {
    name: d.title || d.name || "",
    original_name: d.original_title || d.original_name || "",
    plot: d.overview || "",
    tagline: d.tagline || "",
    genres: (d.genres || []).map((g) => g.name),
    cast: (d.credits?.cast || []).slice(0, 12).map((p) => p.name),
    director:
      type === "tv"
        ? (d.created_by || []).map((p) => p.name)
        : (d.credits?.crew || []).filter((p) => p.job === "Director").map((p) => p.name),
    year: Number(String(date).slice(0, 4)) || 0,
    release_date: date,
    rating: Math.round((Number(d.vote_average) || 0) * 10) / 10,
    minutes: Number(d.runtime) || Number(d.episode_run_time?.[0]) || 0,
    country: (d.production_countries || []).map((c) => c.name).slice(0, 2).join(", "),
    poster: d.poster_path ? `${IMG}/w500${d.poster_path}` : "",
    backdrop: d.backdrop_path ? `${IMG}/w1280${d.backdrop_path}` : "",
    trailer: video ? `https://www.youtube.com/watch?v=${video.key}` : "",
    seasons: Number(d.number_of_seasons) || 0,
    age: certification(d, type),
    source: "TMDB",
    link: `https://www.themoviedb.org/${type}/${id}`,
  };
}

/** Classificacao indicativa: a do Brasil (L, 10, 12...) ou, se nao tiver, a dos EUA (PG-13...). */
function certification(d, type) {
  const of = (cc) => {
    if (type === "tv") return (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === cc)?.rating || "";
    const dates = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === cc)?.release_dates || [];
    return dates.map((x) => x.certification).find(Boolean) || "";
  };
  return String(of("BR") || of("US")).trim();
}

async function fromWikipedia(kind, title, year) {
  const what = kind === "series" ? "série" : "filme";
  const q = new URLSearchParams({ action: "query", list: "search", srsearch: `${title} ${year || ""} ${what}`, srlimit: "5", format: "json", origin: "*" });
  const hits = (await getJson(`https://pt.wikipedia.org/w/api.php?${q}`)).query?.search || [];
  const want = fold(title);
  // So aceita uma pagina cujo titulo comeca pelo nome procurado ("Duna (filme de 2021)").
  const hit = hits.find((h) => fold(h.title).startsWith(want) && (!/\(/.test(h.title) || new RegExp(kind === "series" ? "s[eé]rie|televis" : "filme", "i").test(h.title)));
  if (!hit) return null;
  const page = await getJson(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`);
  const desc = fold(page.description || "") + " " + fold(page.extract || "").slice(0, 300);
  if (page.type !== "standard" || !/filme|serie|televis|animac|documentario|novela|anime|minisserie/.test(desc)) return null;
  return {
    plot: String(page.extract || "").trim(),
    poster: page.thumbnail?.source || "",
    source: "Wikipédia",
    link: page.content_urls?.desktop?.page || "",
  };
}

/** Busca dados de fora para um titulo. Nunca lanca erro: sem resultado devolve null. */
export async function lookupOnline(kind, name, year, tmdbId = "") {
  if (process.env.RTEC_NO_ONLINE_INFO === "1") return null;
  const title = cleanTitle(name);
  if (!title) return null;
  const key = `${kind}|${fold(title)}|${year || ""}|${tmdbId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  let data = null;
  try {
    data = process.env.TMDB_API_KEY ? await fromTmdb(kind, title, year, tmdbId) : null;
  } catch {
    data = null;
  }
  if (!data) data = await fromWikipedia(kind, title, year).catch(() => null);
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** Junta a ficha do fornecedor com a da internet: o que o fornecedor ja tem continua valendo. */
export function mergeInfo(base, extra) {
  if (!extra) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const empty = out[k] === undefined || out[k] === "" || out[k] === 0 || (Array.isArray(out[k]) && !out[k].length);
    if (empty && v !== undefined) out[k] = v;
  }
  // Sinopse curta demais do fornecedor ("Sem descricao") perde para a da internet.
  if (extra.plot && (base.plot || "").length < 40) out.plot = extra.plot;
  if (extra.source) out.source = extra.source;
  return out;
}
