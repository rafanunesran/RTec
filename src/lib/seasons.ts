import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";

// Quantas temporadas cada serie tem, para o "T2" nos cards. A lista do fornecedor nao traz o numero:
// o servidor conta pelos episodios. Aqui pede so as series que aparecem na tela, em lotes, e guarda no aparelho.

const KEY = "rtec:seasons";
const TTL = 3 * 24 * 3600 * 1000;
const TTL_NONE = 24 * 3600 * 1000; // sem resposta do fornecedor: tenta de novo amanha
const BATCH = 30;

type Entry = [n: number, at: number];
let cache: Record<string, Entry> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const pending = new Set<string>();
const asked = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let busy = false;

function read() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    cache = {};
  }
  const now = Date.now();
  for (const [id, [n, at]] of Object.entries(cache!)) if (now - at > (n ? TTL : TTL_NONE)) delete cache![id];
  return cache!;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // aparelho sem espaco: fica so na memoria
  }
}

async function flush() {
  timer = null;
  if (busy || !pending.size) return;
  busy = true;
  const ids = [...pending].slice(0, BATCH);
  ids.forEach((id) => pending.delete(id));
  try {
    const got = await api.get<Record<string, number>>(`/api/player/xtream/seasons?ids=${ids.map(encodeURIComponent).join(",")}`);
    const all = read();
    const now = Date.now();
    for (const id of ids) all[id] = [Number(got[id]) || 0, now];
    write();
    version++;
    listeners.forEach((l) => l());
  } catch {
    // lista sem API Xtream ou servidor fora: nao insiste nesta sessao
  }
  busy = false;
  if (pending.size) timer = setTimeout(flush, 50);
}

/** Temporadas da serie (id do catalogo Xtream), ou 0 enquanto nao sabe. Pede ao servidor se ainda nao tem. */
export function seasonsOf(id: string): number {
  if (!id) return 0;
  const hit = read()[id];
  if (hit) return hit[0];
  if (!asked.has(id)) {
    asked.add(id);
    pending.add(id);
    if (!timer) timer = setTimeout(flush, 150);
  }
  return 0;
}

/** "2020 · ★ 6.0" -> "2020 · ★ 6.0 · T2". */
export const withSeasons = (sub: string | undefined, n: number) => (n ? [sub, `T${n}`].filter(Boolean).join(" · ") : sub);

/** Re-renderiza quando chegam numeros novos. */
export function useSeasonsVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}
