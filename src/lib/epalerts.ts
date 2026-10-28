import { useEffect, useState } from "react";
import { api } from "./api";
import { currentProfile, scoped } from "./profiles";

// Alertas de novos episodios, por perfil. Na lista Xtream o servidor confere os episodios no fornecedor
// (no maximo a cada 3 h); nas listas M3U o aparelho ja tem todos os episodios e so compara com o que o cliente viu.
// Series favoritas entram sozinhas; o sino da serie liga ou desliga.

export type Snap = { count: number; top: number };
export type EpAlert = {
  id: string;
  name: string;
  logo: string;
  series_id: string;
  fav: boolean;
  base: Snap | null;
  new: number;
  season: number;
  episode: number;
};
type Response = { mode: "xtream" | "m3u"; checked_at: number; items: EpAlert[] };
/** Serie do jeito que o servidor guarda (id do card da serie, igual ao dos favoritos). */
export type SeriesRef = { id: string; name: string; logo: string; series_id?: string };

const TOP = 10_000;
const SHOWN = "rtec:ep-alerts-shown"; // aviso ja mostrado (para nao abrir de novo a cada vez que entra)
const CHANGED = "rtec:ep-alerts";
const RECHECK_MS = 3 * 3600_000;

let items: EpAlert[] = [];
let off = new Set<string>(); // desligados neste aparelho antes da resposta do servidor
let loadedAt = 0;
let loading: Promise<void> | null = null;

const emit = () => window.dispatchEvent(new Event(CHANGED));
const q = () => `?profile=${encodeURIComponent(currentProfile())}`;

export function snapshot(episodes: { season?: number; episode?: number }[]): Snap {
  let top = 0;
  for (const ep of episodes) top = Math.max(top, (ep.season || 1) * TOP + (ep.episode || 0));
  return { count: episodes.length, top };
}
function newCount(base: Snap | null, cur: Snap) {
  if (!base) return 0;
  if (cur.count > base.count) return cur.count - base.count;
  return cur.top > base.top ? 1 : 0;
}

/**
 * Busca os alertas do perfil. Nas listas M3U, episodesOf devolve os episodios da serie que estao no aparelho
 * (serie sem comparacao guardada ganha a de agora, sem avisar).
 */
export function loadEpAlerts(episodesOf: (a: EpAlert) => { season?: number; episode?: number }[] | null, force = false): Promise<void> {
  if (loading) return loading;
  if (!force && Date.now() - loadedAt < RECHECK_MS && loadedAt) return Promise.resolve();
  const profile = currentProfile();
  loading = api
    .get<Response>(`/api/player/alerts${q()}`)
    .then((r) => {
      if (profile !== currentProfile()) return;
      let list = r.items;
      if (r.mode === "m3u") {
        list = list.map((a) => {
          const eps = episodesOf(a);
          if (!eps?.length) return a;
          const cur = snapshot(eps);
          if (!a.base) void markSeen(a, eps);
          const n = newCount(a.base, cur);
          return { ...a, new: n, season: n ? Math.floor(cur.top / TOP) : 0, episode: n ? cur.top % TOP : 0 };
        });
      }
      items = list.filter((a) => !off.has(a.id));
      loadedAt = Date.now();
      emit();
    })
    .catch(() => {
      /* sem rede: tenta na proxima vez */
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Troca de perfil ou de conta: esquece os alertas do anterior. */
export function resetEpAlerts() {
  items = [];
  off = new Set();
  loadedAt = 0;
  emit();
}

export const epAlerts = () => items;
export const withNew = () => items.filter((a) => a.new > 0);
export const alertOn = (id: string) => items.some((a) => a.id === id);

/** Liga ou desliga o sino da serie (episodes: os que estao na tela agora, viram os "ja vistos"). */
export async function setEpAlert(s: SeriesRef, on: boolean, episodes?: { season?: number; episode?: number }[] | null) {
  const snap = episodes?.length ? snapshot(episodes) : null;
  if (on) {
    off.delete(s.id);
    if (!alertOn(s.id)) items = [...items, { id: s.id, name: s.name, logo: s.logo, series_id: s.series_id || "", fav: false, base: snap, new: 0, season: 0, episode: 0 }];
  } else {
    off.add(s.id);
    items = items.filter((a) => a.id !== s.id);
  }
  emit();
  await api.put(`/api/player/alerts${q()}`, { ...s, series_id: s.series_id || "", on, ...(snap ?? {}) });
}

/** Favoritou a serie: o alerta liga sozinho (o servidor segue os favoritos). */
export function favoriteAdded(s: SeriesRef, episodes?: { season?: number; episode?: number }[] | null) {
  const snap = episodes?.length ? snapshot(episodes) : null;
  off.delete(s.id);
  if (!alertOn(s.id)) items = [...items, { id: s.id, name: s.name, logo: s.logo, series_id: s.series_id || "", fav: true, base: snap, new: 0, season: 0, episode: 0 }];
  emit();
  // on: null = segue o favorito (se o sino estava desligado, liga de novo).
  void api.put(`/api/player/alerts${q()}`, { ...s, series_id: s.series_id || "", on: null, ...(snap ?? {}) }).catch(() => {});
}
export function favoriteRemoved(id: string) {
  if (!items.some((a) => a.id === id && a.fav)) return;
  items = items.filter((a) => a.id !== id);
  emit();
}

/** O cliente abriu a serie com alerta: os episodios de agora passam a ser os "ja vistos". */
export async function markSeen(s: SeriesRef, episodes: { season?: number; episode?: number }[]) {
  if (!episodes.length) return;
  const snap = snapshot(episodes);
  const a = items.find((x) => x.id === s.id);
  if (a) {
    if (a.base && a.base.count === snap.count && a.base.top === snap.top && !a.new) return;
    items = items.map((x) => (x.id === s.id ? { ...x, base: snap, new: 0, season: 0, episode: 0 } : x));
    emit();
  }
  await api.post(`/api/player/alerts/seen${q()}`, { id: s.id, name: s.name, logo: s.logo, series_id: s.series_id || "", ...snap }).catch(() => {});
}

/** O aviso so abre de novo quando aparece um episodio novo que ainda nao foi avisado. */
const sig = (a: EpAlert) => `${a.id}:${a.season}:${a.episode}`;
function shownList(): string[] {
  try {
    return JSON.parse(localStorage.getItem(scoped(SHOWN)) || "[]");
  } catch {
    return [];
  }
}
export function shouldShow(list: EpAlert[]) {
  const seen = new Set(shownList());
  return list.some((a) => !seen.has(sig(a)));
}
export function markShown(list: EpAlert[]) {
  try {
    localStorage.setItem(scoped(SHOWN), JSON.stringify([...new Set([...list.map(sig), ...shownList()])].slice(0, 200)));
  } catch {
    /* armazenamento indisponivel */
  }
}

export const epLabel = (a: EpAlert) => (a.new > 1 ? `${a.new} episódios novos · até T${a.season} E${a.episode}` : `Novo: T${a.season} E${a.episode}`);

/** Le de novo quando os alertas mudam. */
export function useEpAlerts() {
  const [v, setV] = useState(items);
  useEffect(() => {
    const on = () => setV(items);
    window.addEventListener(CHANGED, on);
    on();
    return () => window.removeEventListener(CHANGED, on);
  }, []);
  return v;
}
