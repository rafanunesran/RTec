import type { Channel } from "@/lib/api";
import { allProgress, clearProgress, mergeProgress, onProgressSaved, type Progress } from "@/lib/progress";

// Sincroniza favoritos, historico e progresso com a conta do cliente, para continuar em outro aparelho.
// O aparelho continua guardando tudo no localStorage (abre rapido e funciona sem rede);
// as mudancas sobem ao servidor em lotes e, ao abrir ou voltar para o app, vem o que mudou nos outros aparelhos.

type ListKey = "favorites" | "history";
type Remote = { favorites: Channel[]; favorites_t: number; history: Channel[]; history_t: number; progress: Record<string, Progress> };

const KEYS: Record<ListKey, string> = { favorites: "rtec:favs", history: "rtec:history" };
const META = "rtec:sync"; // { user }: de qual conta sao os dados guardados neste aparelho
const LIST_DELAY = 1500;
const PROGRESS_DELAY = 30_000; // progresso muda a cada 5 s; sobe no maximo a cada 30 s (economiza gravacoes)
const KEEPALIVE_MAX = 60_000; // limite do navegador para requisicoes que sobrevivem ao fechar a aba

let user = "";
const dirty = { favorites: false, history: false, progress: new Set<string>() };
let timer: ReturnType<typeof setTimeout> | undefined;
let dueAt = 0;
let running: Promise<void> | null = null;
let again = false;
const listeners = new Set<(key: ListKey, items: Channel[]) => void>();

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponivel */
  }
}

function schedule(ms: number) {
  const at = Date.now() + ms;
  if (timer && dueAt <= at) return;
  clearTimeout(timer);
  dueAt = at;
  timer = setTimeout(() => {
    timer = undefined;
    void syncNow();
  }, ms);
}

const hasDirty = () => dirty.favorites || dirty.history || dirty.progress.size > 0;

/** Avisa que uma lista mudou neste aparelho (ja salva no localStorage). */
export function listChanged(key: ListKey) {
  if (!user) return;
  dirty[key] = true;
  schedule(LIST_DELAY);
}

/** Recebe as listas que chegaram de outro aparelho. */
export function onRemoteList(fn: (key: ListKey, items: Channel[]) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

onProgressSaved((id) => {
  if (!user) return;
  dirty.progress.add(id);
  schedule(PROGRESS_DELAY);
});

async function send(body: unknown, keepalive: boolean): Promise<Remote> {
  const json = JSON.stringify(body);
  const res = await fetch("/api/player/sync", {
    method: body ? "PUT" : "GET",
    credentials: "include",
    keepalive: keepalive && json.length < KEEPALIVE_MAX,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? json : undefined,
  });
  if (!res.ok) throw new Error(`sync ${res.status}`);
  return res.json();
}

async function run(keepalive: boolean) {
  const me = user;
  const meta = readJson<{ user: string } | null>(META, null);
  const first = meta?.user !== me;
  const body: Record<string, unknown> = {};
  const sent = { favorites: dirty.favorites, history: dirty.history, progress: [...dirty.progress] };

  if (first && !meta) {
    // Aparelho que ja usava o app antes da sincronizacao: junta o que estava guardado nele com a conta.
    body.merge = true;
    body.favorites = readJson(KEYS.favorites, []);
    body.history = readJson(KEYS.history, []);
    body.progress = allProgress();
  } else if (first) {
    // Outra conta usou este aparelho: comeca so com o que esta na conta atual.
    clearProgress();
  } else {
    for (const key of ["favorites", "history"] as const) if (sent[key]) body[key] = readJson(KEYS[key], []);
    const all = allProgress();
    const progress = Object.fromEntries(sent.progress.filter((id) => all[id]).map((id) => [id, all[id]]));
    if (sent.progress.length) body.progress = progress;
  }
  dirty.favorites = dirty.history = false;
  dirty.progress.clear();

  let remote: Remote;
  try {
    remote = await send(Object.keys(body).length ? body : null, keepalive);
  } catch {
    // Sem rede: tenta de novo depois, sem perder o que mudou.
    if (sent.favorites) dirty.favorites = true;
    if (sent.history) dirty.history = true;
    sent.progress.forEach((id) => dirty.progress.add(id));
    if (!first && hasDirty()) schedule(60_000);
    return;
  }

  for (const key of ["favorites", "history"] as const) {
    if (dirty[key]) continue; // mudou de novo enquanto enviava: vale a versao deste aparelho
    const items = remote[key] ?? [];
    if (JSON.stringify(items) === JSON.stringify(readJson(KEYS[key], []))) continue;
    writeJson(KEYS[key], items);
    listeners.forEach((l) => l(key, items));
  }
  mergeProgress(remote.progress ?? {});
  writeJson(META, { user: me });
}

/** Envia o que mudou e busca o que veio de outros aparelhos. */
export function syncNow(keepalive = false): Promise<void> {
  if (!user) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  clearTimeout(timer);
  timer = undefined;
  running = run(keepalive).finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return running;
}

/** Liga a sincronizacao para a conta logada. Devolve a funcao que desliga. */
export function startSync(username: string) {
  user = username;
  void syncNow();
  const onVisibility = () => {
    if (document.visibilityState === "visible") void syncNow();
    else if (hasDirty()) void syncNow(true);
  };
  const onHide = () => hasDirty() && void syncNow(true);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onHide);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onHide);
    if (hasDirty()) void syncNow(true);
    clearTimeout(timer);
    timer = undefined;
    user = "";
  };
}
