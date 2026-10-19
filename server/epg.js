// Guia de programacao (XMLTV): baixa, guarda so a janela util e responde "agora / a seguir".
import zlib from "node:zlib";

const TTL_MS = 3 * 3600 * 1000;
const cache = new Map(); // url -> { at, promise }

/** "20261019120000 +0300" -> Date */
export function parseXmltvDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(value || "");
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00", tz = "+0000"] = m;
  const offset = (Number(tz.slice(0, 3)) * 60 + Math.sign(Number(tz.slice(0, 3)) || 1) * Number(tz.slice(3))) * 60000;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offset);
}

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/** Le o XMLTV e devolve Map(channelId -> programas ordenados) entre 3h atras e 36h a frente. */
export function parseXmltv(xml, now = Date.now()) {
  const from = now - 3 * 3600 * 1000;
  const to = now + 36 * 3600 * 1000;
  const map = new Map();
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const channel = /channel="([^"]*)"/.exec(attrs)?.[1];
    const start = parseXmltvDate(/start="([^"]*)"/.exec(attrs)?.[1]);
    const stop = parseXmltvDate(/stop="([^"]*)"/.exec(attrs)?.[1]);
    if (!channel || !start || !stop || stop.getTime() < from || start.getTime() > to) continue;
    const title = decode(/<title\b[^>]*>([\s\S]*?)<\/title>/.exec(m[2])?.[1] || "");
    const desc = decode(/<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(m[2])?.[1] || "");
    const key = decode(channel).toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ start: start.toISOString(), stop: stop.toISOString(), title, desc: desc.slice(0, 400) });
  }
  for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return map;
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { "User-Agent": "VLC/3.0.20 LibVLC/3.0.20" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return parseXmltv(buf.toString("utf8"));
}

export function loadEpg(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = download(url).catch(() => new Map());
  cache.set(url, { at: Date.now(), promise });
  return promise;
}

/** Programa atual e os proximos para cada id pedido, procurando em todas as fontes de EPG. */
export async function nowNext(urls, ids, now = Date.now()) {
  const maps = await Promise.all(urls.map(loadEpg));
  const out = {};
  for (const id of ids) {
    const key = id.toLowerCase();
    const list = maps.map((m) => m.get(key)).find(Boolean);
    if (!list) continue;
    const idx = list.findIndex((p) => new Date(p.stop).getTime() > now);
    if (idx >= 0) out[id] = list.slice(idx, idx + 4);
  }
  return out;
}
