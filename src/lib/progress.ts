import { useSyncExternalStore } from "react";
import type { Channel } from "@/lib/api";
import { scoped } from "@/lib/profiles";
import { titleKey } from "@/lib/titlekey";

// Quanto de cada filme/episodio ja foi assistido, por perfil. Fica no aparelho e e sincronizado com a conta (sync.ts).
// Guardado pela chave do titulo (titlekey.ts), nao pelo id da lista: trocar ou atualizar a lista nao perde o progresso.
// Progresso antigo, gravado pelo id, ainda e lido e passa para a chave na proxima vez que salvar.
export type Progress = { p: number; d: number; t: number }; // posicao (s), duracao (s), quando (ms)

const KEY = "rtec:progress";
const MAX = 400;
export const WATCHED_AT = 0.92; // a partir daqui conta como "assistido"

let cache: Record<string, Progress> | null = null;
let cacheKey = ""; // de qual perfil e o cache
const listeners = new Set<() => void>();
const saveListeners = new Set<(id: string) => void>();

function read(): Record<string, Progress> {
  if (cache && cacheKey === scoped(KEY)) return cache;
  cacheKey = scoped(KEY);
  try {
    cache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
  } catch {
    cache = {};
  }
  return cache!;
}

export function getProgress(c: Channel): Progress | undefined {
  const all = read();
  return all[titleKey(c)] ?? all[c.id];
}

/** Fracao assistida (0 a 1), ou 0 se nunca assistiu. */
export function fraction(c: Channel): number {
  const pr = getProgress(c);
  return pr && pr.d > 0 ? Math.min(1, pr.p / pr.d) : 0;
}

/** Onde retomar: so se ja passou do comeco e ainda nao terminou. */
export function resumeAt(c: Channel): number {
  const pr = getProgress(c);
  if (!pr || !pr.d) return 0;
  const f = pr.p / pr.d;
  return pr.p > 30 && f < WATCHED_AT ? Math.max(0, pr.p - 5) : 0;
}

export function saveProgress(c: Channel, pos: number, dur: number) {
  const key = titleKey(c);
  if (!key || !Number.isFinite(dur) || dur <= 0) return;
  const all = { ...read(), [key]: { p: Math.round(pos), d: Math.round(dur), t: Date.now() } };
  if (key !== c.id) delete all[c.id];
  write(all);
  saveListeners.forEach((l) => l(key));
}

/** Passa para a chave do titulo o progresso antigo, guardado pelo id da lista (antes de trocar a lista). */
export function adoptProgress(items: Channel[]) {
  const all = read();
  const moved: string[] = [];
  for (const c of items) {
    const old = all[c.id];
    const key = titleKey(c);
    if (!old || key === c.id) continue;
    if (!all[key] || all[key].t < old.t) all[key] = old;
    delete all[c.id];
    moved.push(key);
  }
  if (!moved.length) return;
  write({ ...all });
  moved.forEach((k) => saveListeners.forEach((l) => l(k)));
}

export function allProgress(): Record<string, Progress> {
  return read();
}

/** Junta o progresso vindo de outro aparelho: por item, fica o mais recente. */
export function mergeProgress(remote: Record<string, Progress>) {
  const local = read();
  const newer = Object.entries(remote).filter(([id, r]) => !local[id] || r.t > local[id].t);
  if (newer.length) write({ ...local, ...Object.fromEntries(newer) });
}

export function clearProgress() {
  write({});
}

/** Avisa quando o proprio aparelho salva um progresso (para enviar a conta). */
export function onProgressSaved(fn: (id: string) => void) {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

function write(all: Record<string, Progress>) {
  const ids = Object.keys(all);
  if (ids.length > MAX) {
    ids.sort((a, b) => all[a].t - all[b].t);
    for (const old of ids.slice(0, ids.length - MAX)) delete all[old];
  }
  cache = all;
  cacheKey = scoped(KEY);
  try {
    localStorage.setItem(cacheKey, JSON.stringify(all));
  } catch {
    /* armazenamento indisponivel */
  }
  listeners.forEach((l) => l());
}

/** Re-renderiza o componente quando algum progresso muda. */
export function useProgressVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache,
    () => cache,
  );
}
