// Mesma normalizacao de nomes do aparelho (src/lib/titlekey.ts): acha o mesmo titulo numa lista nova,
// onde os ids e links mudaram, para religar historico e favoritos.

/** "BR: Abelha Rainha (2023) [4K] - Dublado" -> "abelha rainha" */
export function normTitle(name) {
  return String(name || "")
    .replace(/^\s*(\[[A-Z]{2,3}\]|\|[A-Z]{2,3}\||[A-Z]{2,3}\s*[:|])\s*/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\{[^}]*\}|\((19|20)\d{2}\)/g, " ")
    .replace(/\b(dublado|legendado|dub|leg|dual( audio)?|nacional|4k|uhd|fhd|hd|sd|h\.?265|hevc|1080p|720p)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Nome da Serie S01 E02" -> { series: "Nome da Serie", season: 1, episode: 2 } */
export function episodeInfo(name) {
  const m = /^(.*?)[\s._-]*S(\d{1,2})\s*E(\d{1,3})\b/i.exec(String(name || ""));
  if (!m) return null;
  return { series: m[1].trim() || String(name), season: Number(m[2]), episode: Number(m[3]) };
}

/** Episodio guardado: serie, temporada e numero (campos do Xtream ou "S01E02" no nome). */
export function episodeOf(c) {
  if (c.parent_series && c.season) return { series: c.group, season: c.season, episode: c.episode || 0 };
  const info = episodeInfo(c.name);
  if (info) return info;
  if (c.season && c.episode) return { series: c.group, season: c.season, episode: c.episode };
  return null;
}
