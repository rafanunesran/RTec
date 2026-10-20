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

const ext = (v, fallback) => (/^[a-z0-9]{2,5}$/i.test(String(v || "")) ? String(v).toLowerCase() : fallback);

/** Itens de uma categoria (ou todos os canais ao vivo, sem categoria) ja com o link do video. */
export async function items(creds, section, categoryId) {
  const params = { action: SECTION_ACTIONS[section].items };
  if (categoryId) params.category_id = categoryId;
  const list = await call(creds, params);
  const base = `${creds.server}/${section === "live" ? "live" : section === "movie" ? "movie" : "series"}/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}`;
  return (Array.isArray(list) ? list : []).map((it) => {
    if (section === "series") {
      return { kind: "series", series_id: String(it.series_id), name: it.name || it.title || "", logo: it.cover || "", category_id: String(it.category_id ?? "") };
    }
    if (section === "movie") {
      return {
        kind: "movie",
        stream_id: String(it.stream_id),
        name: it.name || it.title || "",
        logo: it.stream_icon || "",
        url: `${base}/${it.stream_id}.${ext(it.container_extension, "mp4")}`,
        category_id: String(it.category_id ?? ""),
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
