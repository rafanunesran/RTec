import type { Channel } from "@/lib/api";

// Chave estavel de um titulo, que nao depende da lista: o mesmo filme, episodio ou canal tem a mesma chave
// mesmo trocando o link M3U, o servidor Xtream ou atualizando a lista (os ids e links mudam, o nome nao).
// Usada para guardar o progresso e para religar historico e favoritos ao catalogo novo.
// O servidor (server/titlekey.js) normaliza nomes do mesmo jeito.

/** "BR: Abelha Rainha (2023) [4K] - Dublado" -> "abelha rainha" */
export function normTitle(name: string): string {
  return String(name || "")
    .replace(/^\s*(\[[A-Z]{2,3}\]|\|[A-Z]{2,3}\||[A-Z]{2,3}\s*[:|])\s*/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\{[^}]*\}|\((19|20)\d{2}\)|\(\s*(cinema|hdcam|cam|ts)\s*\)/g, " ")
    .replace(/\b(dublado|legendado|dub|leg|dual( audio)?|nacional|4k|uhd|fhd|hd|sd|h\.?265|hevc|1080p|720p)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Nome da Serie S01 E02" -> { series: "Nome da Serie", season: 1, episode: 2 } */
export function episodeInfo(name: string) {
  const m = /^(.*?)[\s._-]*S(\d{1,2})\s*E(\d{1,3})\b/i.exec(name);
  if (!m) return { series: name.trim(), season: 1, episode: 0 };
  return { series: m[1].trim() || name, season: Number(m[2]), episode: Number(m[3]) };
}

const isSeriesCard = (c: Channel) => c.kind === "series" && (!!c.series_id || c.id.startsWith("serie:"));

/** Episodio: serie, temporada e numero, pelo nome ("S01E02") ou pelos campos do Xtream. */
function episodeOf(c: Channel) {
  if (c.parent_series && c.season) return { series: c.group, season: c.season, episode: c.episode || 0 };
  const info = episodeInfo(c.name);
  if (info.episode) return info;
  if (c.season && c.episode) return { series: c.group, season: c.season, episode: c.episode };
  return null;
}

export function titleKey(c: Channel): string {
  if (isSeriesCard(c)) return `series:${normTitle(c.name)}`;
  if (c.kind === "series") {
    const ep = episodeOf(c);
    if (ep && normTitle(ep.series)) return `ep:${normTitle(ep.series)}:${ep.season}:${ep.episode}`;
  }
  const n = normTitle(c.name);
  return n ? `${c.kind}:${n}` : c.id;
}

/** Canal ao vivo tambem pode ser achado pelo tvg-id da lista (quando nao e o id interno do Xtream). */
export const epgKey = (c: Channel) => (c.kind === "live" && c.epg_id && !c.epg_id.startsWith("xt:") ? `epg:${c.epg_id.toLowerCase()}` : "");

/** Serie de um episodio ("series:nome"), ou "" se nao for episodio. */
export function seriesKeyOf(c: Channel): string {
  if (c.kind !== "series" || isSeriesCard(c)) return "";
  const ep = episodeOf(c);
  const n = ep ? normTitle(ep.series) : "";
  return n ? `series:${n}` : "";
}

/** Lista do mais recente para o mais antigo: deixa so o ultimo episodio tocado de cada serie. */
export function lastEpisodePerSeries(list: Channel[]): Channel[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = seriesKeyOf(c);
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
