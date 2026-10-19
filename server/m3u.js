// Utilitarios para buscar, montar e mesclar listas M3U.

const CACHE_TTL_MS = Number(process.env.M3U_CACHE_SECONDS || 300) * 1000;
const cache = new Map();

export function xtreamM3uUrl(p) {
  const server = p.xtream_server.replace(/\/+$/, "");
  const q = new URLSearchParams({
    username: p.xtream_username,
    password: p.xtream_password,
    type: "m3u_plus",
    output: "ts",
  });
  return `${server}/get.php?${q}`;
}

export function sourceUrl(p) {
  if (p.kind === "m3u_url") return p.url;
  if (p.kind === "xtream") return xtreamM3uUrl(p);
  return null;
}

async function fetchText(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "RTecPanel/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  cache.set(url, { at: Date.now(), text });
  return text;
}

export async function loadPlaylistText(p) {
  if (p.kind === "manual") return p.content;
  return fetchText(sourceUrl(p));
}

/** Remove o cabecalho #EXTM3U e devolve so as entradas. */
export function stripHeader(text) {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => !/^#EXTM3U/i.test(line.trim()))
    .join("\n")
    .trim();
}

export function countChannels(text) {
  return (text.match(/^#EXTINF/gim) || []).length;
}

export function parseEntries(text, limit = 50) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const line = lines[i].trim();
    if (!/^#EXTINF/i.test(line)) continue;
    const name = line.slice(line.lastIndexOf(",") + 1).trim();
    const group = /group-title="([^"]*)"/i.exec(line)?.[1] || "";
    const logo = /tvg-logo="([^"]*)"/i.exec(line)?.[1] || "";
    const tvgId = /tvg-id="([^"]*)"/i.exec(line)?.[1] || "";
    let url = "";
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (l && !l.startsWith("#")) {
        url = l;
        break;
      }
    }
    out.push({ name, group, logo, url, tvg_id: tvgId, kind: contentKind(url, group, name) });
  }
  return out;
}

/** Classifica a entrada em TV ao vivo, filme ou serie (padrao de URL do Xtream, extensao e nome). */
export function contentKind(url, group = "", name = "") {
  const path = url.split("?")[0].toLowerCase();
  if (/\/series\//.test(path)) return "series";
  if (/\/movies?\//.test(path)) return "movie";
  if (/\/live\//.test(path)) return "live";
  if (/\.(mp4|mkv|avi|mov|m4v|webm)$/.test(path)) {
    return /\bs[eé]ries?\b/i.test(group) || /\bS\d{1,2}\s*E\d{1,3}\b/i.test(name) ? "series" : "movie";
  }
  return "live";
}

/** URLs de EPG anunciadas no cabecalho da lista (url-tvg / x-tvg-url). */
export function headerEpgUrls(text) {
  const first = text.slice(0, 2000).split(/\r?\n/).find((l) => /^#EXTM3U/i.test(l.trim())) || "";
  const m = /(?:url-tvg|x-tvg-url)="([^"]+)"/i.exec(first);
  return m ? m[1].split(",").map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)) : [];
}

/** Junta varias listas em um unico M3U. Fontes com erro viram comentario. */
export async function buildMergedM3u(playlists) {
  const epgs = playlists.map((p) => p.epg_url).filter(Boolean);
  const header = epgs.length ? `#EXTM3U url-tvg="${epgs.join(",")}"` : "#EXTM3U";
  const parts = await Promise.all(
    playlists.map(async (p) => {
      try {
        return stripHeader(await loadPlaylistText(p));
      } catch (err) {
        return `# Falha ao carregar "${p.name}": ${err.message}`;
      }
    }),
  );
  return [header, ...parts.filter(Boolean)].join("\n") + "\n";
}
