import { api, type Channel } from "@/lib/api";
import { episodeInfo, epgKey, normTitle, titleKey } from "@/lib/titlekey";

// Trocar o link M3U, o servidor Xtream ou atualizar a lista muda os ids e os links de tudo.
// Historico e favoritos guardam o titulo inteiro, entao aqui cada item e achado de novo na lista atual
// pela chave do titulo (nome, temporada e episodio; tvg-id nos canais) e passa a apontar para ela.
// O que nao existe mais na lista nova fica como estava (pode voltar numa proxima troca).

export type Relinked = Map<string, Channel>; // id antigo -> item na lista atual

/** Lista M3U: o catalogo inteiro ja esta no aparelho. */
export function relinkM3u(saved: Channel[], channels: Channel[]): Relinked {
  const ids = new Set(channels.map((c) => c.id));
  const byKey = new Map<string, Channel>();
  const series = new Map<string, string>(); // nome normalizado -> nome da serie nesta lista
  for (const c of channels) {
    for (const k of [titleKey(c), epgKey(c)]) if (k && !byKey.has(k)) byKey.set(k, c);
    if (c.kind === "series") {
      const name = episodeInfo(c.name).series;
      if (!series.has(normTitle(name))) series.set(normTitle(name), name);
    }
  }
  const out: Relinked = new Map();
  for (const it of saved) {
    if (ids.has(it.id)) continue;
    if (it.id.startsWith("serie:") || it.series_id) {
      const name = series.get(normTitle(it.name));
      if (name) out.set(it.id, { ...it, id: `serie:${name}`, series_id: undefined, name, group: name, playlist_id: "own" });
      continue;
    }
    const hit = byKey.get(titleKey(it)) ?? byKey.get(epgKey(it));
    if (hit) out.set(it.id, hit);
  }
  return out;
}

/** Lista Xtream: o servidor procura na lista atual (o catalogo vem por partes). */
export async function relinkXtream(saved: Channel[]): Promise<Relinked> {
  const out: Relinked = new Map();
  for (let i = 0; i < saved.length; i += 200) {
    const chunk = saved.slice(i, i + 200);
    const res = await api.post<{ items: (Channel | null)[] }>("/api/player/relink", { items: chunk });
    chunk.forEach((it, j) => res.items[j] && out.set(it.id, res.items[j]!));
  }
  return out;
}

/** Aplica a troca numa lista guardada, sem repetir itens. Devolve a mesma lista se nada mudou. */
export function applyRelink(items: Channel[], map: Relinked): Channel[] {
  if (!items.some((c) => map.has(c.id))) return items;
  const seen = new Set<string>();
  return items
    .map((c) => map.get(c.id) ?? c)
    .filter((c) => !seen.has(c.id) && !!seen.add(c.id));
}
