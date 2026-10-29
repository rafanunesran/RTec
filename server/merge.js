// Varias listas por cliente: o reprodutor continua vendo um catalogo so (como hoje) e as listas extras
// completam o que falta na principal. O mesmo titulo em mais de uma lista aparece uma vez, com os links das
// outras listas como reserva ("more"): se um nao tocar, o reprodutor tenta o proximo.
//
// Ids: a lista principal mantem os ids de sempre (historico, favoritos e bloqueios continuam valendo).
// Itens das listas extras levam a chave da lista na frente: "<chave>~<id do fornecedor>".
import crypto from "node:crypto";
import * as xtream from "./xtream.js";
import { loadPlaylistText, parseEntries } from "./m3u.js";
import { episodeInfo, normTitle } from "./titlekey.js";

const hash = (...parts) => crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 10);
const TTL_MS = 10 * 60 * 1000;
const fold = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Chave curta e fixa de uma lista: so muda quando o link ou o login da lista muda. */
export function sourceKey(p) {
  const creds = xtream.xtreamCredentials(p);
  if (creds) return hash(creds.server.toLowerCase(), creds.username, creds.password).slice(0, 6);
  return hash(p.kind, p.url || "", p.kind === "manual" ? p.content || "" : "").slice(0, 6);
}

/** Ano no nome do titulo: "Filme (2019)". */
const yearInName = (name) => Number(/\((19|20)\d{2}\)/.exec(String(name))?.[0].slice(1, 5)) || 0;

// ---------- Fontes no mesmo formato da API Xtream ----------

function xtreamProvider(creds) {
  return {
    categories: (section) => xtream.categories(creds, section),
    items: (section, category) => xtream.items(creds, section, category),
    episodes: (id) => xtream.seriesEpisodes(creds, id),
    info: (kind, id) => xtream.titleInfo(creds, kind, id),
    epg: (id) => xtream.shortEpg(creds, id),
  };
}

const m3uCache = new Map();

/** Lista M3U comum (sem API Xtream) lida como se fosse Xtream: grupos viram categorias, "S01 E02" vira serie. */
function m3uProvider(p, key) {
  const load = () => {
    const hit = m3uCache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
    const data = loadPlaylistText(p).then((text) => {
      const out = { live: [], radio: [], movie: [], series: [], cats: { live: new Map(), radio: new Map(), movie: new Map(), series: new Map() }, episodes: new Map() };
      for (const e of parseEntries(text, Infinity)) {
        if (!/^https?:\/\//i.test(e.url)) continue;
        const group = e.group || "Outros";
        const category_id = hash(group).slice(0, 8);
        out.cats[e.kind].set(category_id, group);
        if (e.kind === "series") {
          const info = episodeInfo(e.name);
          const name = info?.series || e.name;
          const series_id = hash(normTitle(name) || name);
          if (!out.episodes.has(series_id)) {
            out.episodes.set(series_id, []);
            out.series.push({ kind: "series", series_id, name, logo: e.logo, category_id, added: 0, year: yearInName(name), rating: 0, genre: "" });
          }
          const eps = out.episodes.get(series_id);
          eps.push({ kind: "series", stream_id: hash(e.url), season: info?.season || 1, episode: info?.episode || eps.length + 1, name: e.name, logo: e.logo, url: e.url });
          continue;
        }
        const hls = e.kind === "live" && /\/live\/.+\.ts$/i.test(e.url.split("?")[0]) ? e.url.replace(/\.ts(\?|$)/i, ".m3u8$1") : "";
        out[e.kind].push({
          kind: e.kind,
          stream_id: hash(e.url),
          name: e.name,
          logo: e.logo,
          url: e.url,
          ...(hls ? { alt_url: hls } : {}),
          category_id,
          added: 0,
          ...(e.kind === "live" ? { tvg_id: e.tvg_id } : e.kind === "radio" ? {} : { year: yearInName(e.name), rating: 0, genre: "" }),
        });
      }
      return out;
    });
    m3uCache.set(key, { at: Date.now(), data });
    data.catch(() => m3uCache.delete(key));
    return data;
  };
  return {
    categories: async (section) => [...(await load()).cats[section]].map(([id, name]) => ({ id, name })),
    items: async (section, category) => (await load())[section].filter((it) => !category || it.category_id === category),
    episodes: async (id) => [...((await load()).episodes.get(id) || [])].sort((a, b) => a.season - b.season || a.episode - b.episode),
    info: async () => ({}),
    epg: async () => [],
  };
}

function providerFor(p, key) {
  const creds = xtream.xtreamCredentials(p);
  return creds ? xtreamProvider(creds) : m3uProvider(p, key);
}

// ---------- Catalogo ----------

/** Secoes em que titulos repetidos dentro da mesma lista viram um so (canais e radios ficam como vieram). */
const joins = (section) => section === "movie" || section === "series";
const sameYear = (a, b) => !a.year || !b.year || a.year === b.year;
const rawId = (it) => it.series_id || it.stream_id;

/**
 * Versao do titulo, que o nome normalizado nao mostra: "L|4K" (legendado em 4K), "|FHD", "|" (sem marca).
 * As versoes do mesmo titulo viram um item so e o reprodutor deixa escolher entre elas.
 */
export const variant = (name) => {
  const n = String(name || "");
  const lang = /\[L\]|\(L\)|\blegendad|\bleg\b/i.test(n) ? "L" : "";
  const q = /\b(4k|uhd|2160p)\b/i.test(n) ? "4K" : /\b(fhd|1080p)\b/i.test(n) ? "FHD" : /\b(hd|720p)\b/i.test(n) ? "HD" : /\bsd\b/i.test(n) ? "SD" : "";
  return `${lang}|${q}`;
};

/** O titulo que fica no catalogo herda o que so a copia repetida trazia (nota, ano, genero, capa). */
function fillIn(dst, src) {
  if (src.rating > (dst.rating || 0)) dst.rating = src.rating;
  if (!dst.year && src.year) dst.year = src.year;
  if (!dst.genre && src.genre) dst.genre = src.genre;
  if (!dst.logo && src.logo) dst.logo = src.logo;
  if (src.added > (dst.added || 0)) dst.added = src.added;
  if (src._tag === "|" && dst._tag !== "|" && !dst._named) {
    dst.name = src.name;
    dst._named = true;
  }
}
const memoCache = new Map();

/**
 * Catalogo do cliente no formato Xtream. sources[0] e a lista principal (precisa ser Xtream); as demais podem
 * ser Xtream ou M3U. Cada item devolvido tem _i (de qual lista veio) e, com mais de uma lista, _alts (o mesmo
 * titulo nas outras listas).
 */
export function createCatalog(sources) {
  const srcs = sources.map((p, i) => ({ ...p, key: i === 0 ? "" : p.key || sourceKey(p) }));
  const provs = srcs.map((p) => providerFor(p, p.key || sourceKey(p)));
  const merged = srcs.length > 1;
  const sig = srcs.map((p) => sourceKey(p)).join(".");
  const qualify = (i, id) => (i ? `${srcs[i].key}~${id}` : String(id));

  const memo = (name, fn) => {
    const k = `${sig}|${name}`;
    const hit = memoCache.get(k);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = fn();
    memoCache.set(k, { at: Date.now(), value });
    value.catch(() => memoCache.delete(k));
    if (memoCache.size > 300) memoCache.delete(memoCache.keys().next().value);
    return value;
  };

  // Categorias com o mesmo nome em listas diferentes viram uma so (as da principal mantem o id).
  const cats = (section) =>
    memo(`c|${section}`, async () => {
      const lists = await Promise.all(provs.map((p, i) => (i ? p.categories(section).catch(() => []) : p.categories(section))));
      const list = [];
      const byName = new Map();
      const map = new Map(); // "lista|categoria" -> id no catalogo
      lists.forEach((cs, i) => {
        for (const cat of cs) {
          const k = fold(cat.name) || `${i}|${cat.id}`;
          let m = i ? byName.get(k) : null;
          if (!m) {
            m = { id: qualify(i, cat.id), name: cat.name };
            list.push(m);
            if (!byName.has(k)) byName.set(k, m);
          }
          map.set(`${i}|${cat.id}`, m.id);
        }
      });
      return { list, map };
    });

  // Todos os titulos de uma secao, juntando as listas: o mesmo nome (e ano) em outra lista vira reserva.
  // Filmes e series repetidos dentro da mesma lista (o fornecedor poe o mesmo titulo em varias categorias, e
  // dublado/legendado/4K como titulos separados) tambem viram um so, desde que o ano nao seja diferente. As
  // versoes (_tag) ficam nas reservas e o reprodutor deixa trocar. O titulo que fica herda a nota, o ano, o
  // genero e a capa que faltarem nele, e o nome sem marca de versao.
  const index = (section) =>
    memo(`i|${section}`, async () => {
      const dedupe = joins(section);
      const [{ map }, lists] = await Promise.all([
        cats(section),
        Promise.all(provs.map((p, i) => (i ? p.items(section, "").catch(() => []) : p.items(section, "")))),
      ]);
      const entries = [];
      const byKey = new Map();
      const byId = new Map();
      lists.forEach((list, i) => {
        for (const raw of list) {
          const it = { ...raw, category_id: map.get(`${i}|${raw.category_id}`) ?? qualify(i, raw.category_id), _i: i };
          const k = normTitle(it.name);
          it._tag = variant(it.name);
          const same = (e) => (e._i !== i ? i : dedupe) && sameYear(e, it);
          const hit = k ? (byKey.get(k) || []).find(same) : null;
          byId.set(qualify(i, rawId(raw)), hit || it);
          if (hit) {
            hit._alts.push(it);
            hit._cats.add(it.category_id);
            fillIn(hit, it);
            continue;
          }
          it._alts = [];
          it._cats = new Set([it.category_id]);
          entries.push(it);
          if (k) (byKey.get(k) || byKey.set(k, []).get(k)).push(it);
        }
      });
      return { entries, byId };
    });

  /** "chave~id" -> lista de origem e id no fornecedor. */
  const ref = (qid) => {
    const s = String(qid || "");
    const at = s.indexOf("~");
    if (at > 0) {
      const i = srcs.findIndex((p, j) => j > 0 && p.key === s.slice(0, at));
      if (i > 0) return { i, id: s.slice(at + 1), prov: provs[i] };
    }
    return { i: 0, id: s, prov: provs[0] };
  };

  return {
    merged,
    sources: srcs,
    qid: (it) => qualify(it._i || 0, rawId(it)),
    ref,
    async categories(section) {
      if (!merged) return provs[0].categories(section);
      return (await cats(section)).list;
    },
    async items(section, category) {
      if (!merged && !joins(section)) return (await provs[0].items(section, category)).map((it) => ({ ...it, _i: 0 }));
      const { entries } = await index(section);
      return category ? entries.filter((e) => e._cats.has(category)) : entries;
    },
    /** Item do catalogo pelo id (com as reservas das outras listas). */
    async find(section, qid) {
      if (!merged && !joins(section)) return null;
      return (await index(section)).byId.get(String(qid)) || null;
    },
    /** Episodios de uma serie; com mais de uma lista, junta temporada/episodio das outras listas. */
    async episodes(qid) {
      const entry = merged || joins("series") ? (await index("series").catch(() => null))?.byId.get(String(qid)) : null;
      if (!entry) {
        const r = ref(qid);
        return (await r.prov.episodes(r.id)).map((ep) => ({ ...ep, _i: r.i }));
      }
      // Reserva de outra lista vem antes da copia repetida na mesma lista (que costuma ser o mesmo arquivo).
      const group = [entry, ...entry._alts.filter((s) => s._i !== entry._i), ...entry._alts.filter((s) => s._i === entry._i)];
      const lists = await Promise.all(
        group.map((s, n) =>
          provs[s._i]
            .episodes(s.series_id)
            .then((eps) => eps.map((ep) => ({ ...ep, _i: s._i, _g: n, _tag: s._tag })))
            .catch((err) => (n === 0 ? Promise.reject(err) : [])),
        ),
      );
      const out = [];
      const byNum = new Map();
      for (const eps of lists) {
        for (const ep of eps) {
          const k = ep.episode ? `${ep.season}|${ep.episode}` : "";
          const hit = k && byNum.get(k);
          if (hit && hit._g !== ep._g) {
            if (ep.url !== hit.url && !hit._alts.some((x) => x.url === ep.url)) hit._alts.push(ep);
            continue;
          }
          const e = { ...ep, _alts: [] };
          if (k && !hit) byNum.set(k, e);
          out.push(e);
        }
      }
      return out.sort((a, b) => a.season - b.season || a.episode - b.episode);
    },
  };
}
