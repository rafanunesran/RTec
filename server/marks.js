// "Pular intro" e "Proximo EP" nos creditos, sem configurar titulo por titulo.
// - Principal: o servidor de video (STREAM_PROXY_URL, Oracle) compara o audio do episodio com o do vizinho
//   e acha a abertura e os creditos de cada um (public/proxy/server.mjs). Demora um pouco na primeira vez;
//   o resultado fica no banco (colecao episode_marks) e vale para todos os clientes com o mesmo episodio.
// - Reforco: TheIntroDB (base publica, pelo codigo TMDB), usada enquanto o audio nao ficou pronto ou quando
//   ele nao achou nada.
import crypto from "node:crypto";

const TIDB = "https://api.theintrodb.org/v4/media";
const POST_MIN = 20; // mesma regra do servidor de video: sobra maior que isso depois dos creditos = cena pos-creditos
export const RETRY_FAILED_MS = 6 * 3600 * 1000;

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const round = (n) => Math.round(n * 10) / 10;

/**
 * Chave do episodio no banco. Links Xtream (".../series/usuario/senha/123.mp4") ficam so com servidor + arquivo,
 * entao outras linhas do mesmo fornecedor aproveitam a analise; outros links usam o caminho inteiro.
 */
export function markKey(url) {
  try {
    const u = new URL(url);
    const file = u.pathname.split("/").pop() || "";
    const id = /^\d+\.\w{2,5}$/.test(file) ? file : `${u.pathname}${u.search}`;
    return sha1(`${u.host.toLowerCase()}|${id}`).slice(0, 24);
  } catch {
    return "";
  }
}

/** Vizinhos para comparar: o proximo da mesma temporada primeiro, depois o anterior. */
export function neighbors(episodes, i) {
  const ep = episodes[i];
  const same = (e) => e && e.url && e.season === ep.season;
  return [episodes[i + 1], episodes[i - 1]].filter(same).concat([episodes[i + 1], episodes[i - 1]].filter((e) => e?.url && !same(e))).slice(0, 2);
}

/** Marcas no formato que vai para o reprodutor. */
export function cleanMarks(m) {
  if (!m) return null;
  const intro = Array.isArray(m.intro) && m.intro[1] > m.intro[0] ? [round(m.intro[0]), round(m.intro[1])] : null;
  const credits = Number(m.credits) > 0 ? round(m.credits) : null;
  if (!intro && credits == null) return null;
  return { intro, credits, post: credits != null && !!m.post };
}

/** Resposta da TheIntroDB (v4) para o mesmo formato. dur em segundos (0 se nao souber). */
export function fromTheIntroDb(data, dur = 0) {
  const intro = (data?.intro || []).find((s) => s && s.end_ms != null);
  const cr = (data?.credits || []).find((s) => s && s.start_ms != null);
  let post = false;
  if (cr && cr.end_ms != null) post = dur ? dur - cr.end_ms / 1000 > POST_MIN : true;
  return cleanMarks({
    intro: intro ? [(intro.start_ms || 0) / 1000, intro.end_ms / 1000] : null,
    credits: cr ? cr.start_ms / 1000 : null,
    post,
  });
}

const tidbCache = new Map();

/** Consulta a TheIntroDB. Nunca lanca erro: sem resultado devolve null. */
export async function theIntroDb(tmdbId, season, episode, dur = 0) {
  if (!/^\d+$/.test(String(tmdbId || "")) || process.env.RTEC_NO_ONLINE_INFO === "1") return null;
  const key = `${tmdbId}|${season}|${episode}`;
  const hit = tidbCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.data;
  let data = null;
  try {
    const q = new URLSearchParams({ tmdb_id: String(tmdbId), season: String(season), episode: String(episode) });
    if (dur > 0) q.set("duration_ms", String(Math.round(dur * 1000)));
    const res = await fetch(`${TIDB}?${q}`, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    if (res.ok) data = fromTheIntroDb(await res.json(), dur);
  } catch {
    data = null;
  }
  if (tidbCache.size > 5000) tidbCache.clear();
  tidbCache.set(key, { at: Date.now(), data });
  return data;
}
