import { useSyncExternalStore } from "react";

// Quanto de cada filme/episodio ja foi assistido. Fica no aparelho e e sincronizado com a conta (sync.ts).
export type Progress = { p: number; d: number; t: number }; // posicao (s), duracao (s), quando (ms)

const KEY = "rtec:progress";
const MAX = 400;
export const WATCHED_AT = 0.92; // a partir daqui conta como "assistido"

let cache: Record<string, Progress> | null = null;
const listeners = new Set<() => void>();
const saveListeners = new Set<(id: string) => void>();

function read(): Record<string, Progress> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    cache = {};
  }
  return cache!;
}

export function getProgress(id: string): Progress | undefined {
  return read()[id];
}

/** Fracao assistida (0 a 1), ou 0 se nunca assistiu. */
export function fraction(id: string): number {
  const pr = getProgress(id);
  return pr && pr.d > 0 ? Math.min(1, pr.p / pr.d) : 0;
}

/** Onde retomar: so se ja passou do comeco e ainda nao terminou. */
export function resumeAt(id: string): number {
  const pr = getProgress(id);
  if (!pr || !pr.d) return 0;
  const f = pr.p / pr.d;
  return pr.p > 30 && f < WATCHED_AT ? Math.max(0, pr.p - 5) : 0;
}

export function saveProgress(id: string, pos: number, dur: number) {
  if (!id || !Number.isFinite(dur) || dur <= 0) return;
  write({ ...read(), [id]: { p: Math.round(pos), d: Math.round(dur), t: Date.now() } });
  saveListeners.forEach((l) => l(id));
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
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
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
