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
    let url = "";
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (l && !l.startsWith("#")) {
        url = l;
        break;
      }
    }
    out.push({ name, group, logo, url });
  }
  return out;
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
