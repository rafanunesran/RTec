// Downloads offline: filmes e episodios guardados no aparelho (IndexedDB, em pedacos) para assistir sem internet.
// O arquivo vem pelo servidor de video (Oracle) com link cifrado. Lista sem blindagem baixa direto do fornecedor
// (o servidor de video fica de reserva), e se uma copia for recusada tenta a mesma em outra lista do cliente.
// Cada download tem validade (renovada quando o aparelho fica online e a conta esta em dia); vencido, nao toca.
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiError, type Channel } from "@/lib/api";
import { tvScreenOn } from "@/lib/tvnav";

export type DownloadStatus = "queued" | "downloading" | "paused" | "done" | "error";

export type Download = {
  id: string;
  account: string;
  title: string;
  item: Channel;
  ext: string;
  size: number;
  done: number;
  parts: number;
  status: DownloadStatus;
  error?: string;
  valid_until: string;
  created_at: number;
  /** O mesmo titulo nas outras listas do cliente (tentado se a copia principal for recusada). */
  more?: string[];
  /** Copia (0 = principal) e caminho que estao baixando, para continuar pelo mesmo arquivo. */
  pick?: number;
  route?: "direct" | "proxy";
};

type Route = { url: string; direct?: string; ext: string };
type LinkResponse = Route & { others?: Route[]; valid_until: string; max_items: number };

export type DownloadConfig = { enabled: boolean; max_items: number; days: number };

const DB_NAME = "rtec-downloads";
const CHUNK = 8 * 1024 * 1024;
const MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", mov: "video/quicktime", avi: "video/x-msvideo" };

// ---------- IndexedDB ----------
let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("Este aparelho não guarda vídeos"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
        if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Não foi possível abrir o armazenamento"));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        const req = run(t);
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("Armazenamento cheio"));
      }),
  );
}

const chunkKey = (id: string, i: number) => `${id}|${String(i).padStart(6, "0")}`;

async function putMeta(d: Download) {
  await tx(["meta"], "readwrite", (t) => t.objectStore("meta").put(d));
}

async function removeAll(id: string) {
  await tx(["meta", "chunks"], "readwrite", (t) => {
    t.objectStore("meta").delete(id);
    t.objectStore("chunks").delete(IDBKeyRange.bound(`${id}|`, `${id}|￿`));
  });
}

// ---------- Estado em memoria (para a tela acompanhar) ----------
let list: Download[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => {
  list = [...list];
  listeners.forEach((l) => l());
};
function setOne(d: Download) {
  const i = list.findIndex((x) => x.id === d.id);
  if (i >= 0) list[i] = d;
  else list.push(d);
  emit();
}

let loading: Promise<void> | null = null;
export function loadDownloads(): Promise<void> {
  if (!loading) {
    loading = tx<Download[]>(["meta"], "readonly", (t) => t.objectStore("meta").getAll())
      .then((all) => {
        // Download que estava baixando quando o app fechou: fica pausado ate o cliente continuar.
        list = (all || []).map((d) => (d.status === "downloading" || d.status === "queued" ? { ...d, status: "paused" as const } : d)).sort((a, b) => b.created_at - a.created_at);
        loaded = true;
        emit();
      })
      .catch(() => {
        loaded = true;
        emit();
      });
  }
  return loading;
}

function subscribe(l: () => void) {
  listeners.add(l);
  void loadDownloads();
  return () => listeners.delete(l);
}

export function useDownloads(account?: string) {
  const all = useSyncExternalStore(subscribe, () => list);
  return { loaded, items: account ? all.filter((d) => d.account === account) : all };
}

export const downloadsCount = () => list.length;
export const isExpired = (d: Download) => Date.parse(d.valid_until) < Date.now();
export const downloadId = (account: string, item: Channel) => `${account}:${item.id}`;

// ---------- Configuracao do revendedor ----------
let config: DownloadConfig | null = null;
const configListeners = new Set<() => void>();
export async function loadDownloadConfig(): Promise<DownloadConfig | null> {
  try {
    config = await api.get<DownloadConfig>("/api/player/downloads/config");
  } catch {
    config = null;
  }
  configListeners.forEach((l) => l());
  return config;
}
/** Downloads aparecem so com a chave ligada e fora da TV (pouco espaco e o navegador da TV apaga os dados). */
export function useDownloadsEnabled() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    configListeners.add(l);
    return () => void configListeners.delete(l);
  }, []);
  return !!config?.enabled && !tvScreenOn() && typeof indexedDB !== "undefined";
}

// ---------- Baixar ----------
let running: { id: string; abort: AbortController } | null = null;

function cleanItem(c: Channel): Channel {
  const { more: _more, versions: _versions, reasons: _reasons, ...rest } = c;
  return rest;
}

export async function startDownload(account: string, item: Channel, title: string) {
  await loadDownloads();
  const id = downloadId(account, item);
  const existing = list.find((d) => d.id === id);
  if (existing) {
    if (existing.status === "paused" || existing.status === "error") return resumeDownload(id);
    return;
  }
  const max = config?.max_items ?? 5;
  if (list.filter((d) => d.account === account).length >= max) throw new Error(`Limite de ${max} downloads neste aparelho. Apague algum para baixar outro.`);
  // Pede ao navegador para nao apagar os videos quando faltar espaco (quando ele deixa).
  navigator.storage?.persist?.().catch(() => {});
  const fileOf = (l: { src: string; type: string; alt: string; alt_type: string }) => (l.type === "file" ? l.src : l.alt_type === "file" ? l.alt : l.src);
  const src = fileOf(item);
  const more = [...new Set((item.more || []).map(fileOf).filter((u) => u && u !== src))].slice(0, 4);
  const link = await api.post<LinkResponse>("/api/player/downloads/link", { src, kind: item.kind, more });
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const d: Download = {
    id,
    account,
    title,
    item: cleanItem({ ...item, src }),
    ext: link.ext,
    size: 0,
    done: 0,
    parts: 0,
    status: "queued",
    valid_until: link.valid_until,
    created_at: Date.now(),
    ...(more.length ? { more } : {}),
  };
  if (est?.quota && est.usage !== undefined && est.quota - est.usage < 300 * 1024 * 1024) throw new Error("Pouco espaço livre no aparelho para baixar.");
  await putMeta(d);
  setOne(d);
  pump(link);
}

export async function resumeDownload(id: string) {
  const d = list.find((x) => x.id === id);
  if (!d || d.status === "done") return;
  const next = { ...d, status: "queued" as const, error: undefined };
  await putMeta(next);
  setOne(next);
  pump();
}

export async function pauseDownload(id: string) {
  if (running?.id === id) running.abort.abort();
  const d = list.find((x) => x.id === id);
  if (d && d.status !== "done") {
    const next = { ...d, status: "paused" as const };
    await putMeta(next);
    setOne(next);
  }
}

export async function deleteDownload(id: string) {
  if (running?.id === id) running.abort.abort();
  await removeAll(id).catch(() => {});
  list = list.filter((d) => d.id !== id);
  emit();
}

/** Apaga tudo (conta bloqueada, lista vencida, downloads desligados, ou outra conta entrou no aparelho). */
export async function deleteDownloads(filter: (d: Download) => boolean = () => true) {
  await loadDownloads();
  for (const d of list.filter(filter)) await deleteDownload(d.id);
}

/** Baixa um por vez, em pedacos de 8 MB (continua de onde parou). */
function pump(firstLink?: LinkResponse) {
  if (running) return;
  const d = list.find((x) => x.status === "queued");
  if (!d) return;
  const abort = new AbortController();
  running = { id: d.id, abort };
  void run(d, abort.signal, firstLink).finally(() => {
    running = null;
    pump();
  });
}

async function freshLink(d: Download) {
  return api.post<LinkResponse>("/api/player/downloads/link", { src: d.item.src, kind: d.item.kind, more: d.more || [] });
}

const routesOf = (l: LinkResponse): Route[] => [{ url: l.url, direct: l.direct, ext: l.ext }, ...(l.others || [])];

/** Resposta do proprio servidor de video para link vencido (o resto vem do fornecedor). */
async function expiredLink(res: Response) {
  const text = await res.text().catch(() => "");
  return /link inv[aá]lido ou expirado/i.test(text);
}

async function run(d0: Download, signal: AbortSignal, firstLink?: LinkResponse) {
  let d: Download = { ...d0, status: "downloading" };
  await putMeta(d);
  setOne(d);
  try {
    let routes = routesOf(firstLink || (await freshLink(d)));
    // Copia e caminho em uso. Direto primeiro quando a lista deixa (fornecedor que recusa o servidor de video).
    let i = Math.min(d.pick || 0, routes.length - 1);
    let direct = d.route ? d.route === "direct" && !!routes[i].direct : !!routes[i].direct;
    const tried = new Set<string>();
    /** Proximo caminho: o mesmo arquivo pelo outro caminho; outra copia so antes de comecar (arquivo diferente). */
    const nextRoute = () => {
      tried.add(`${i}:${direct}`);
      if (!tried.has(`${i}:false`)) direct = false;
      else if (routes[i].direct && !tried.has(`${i}:true`)) direct = true;
      else if (d.done === 0 && i + 1 < routes.length) {
        i++;
        direct = !!routes[i].direct;
      } else return false;
      working = false;
      return true;
    };
    let working = false; // algum pedaco ja veio por este caminho
    let retries = 0;
    let renewed = 0;
    while (!d.size || d.done < d.size) {
      const end = d.done + CHUNK - 1;
      const url = direct ? routes[i].direct! : routes[i].url;
      let res: Response;
      try {
        res = await fetch(url, { headers: { Range: `bytes=${d.done}-${end}` }, signal });
      } catch (err) {
        if (signal.aborted) return;
        // Direto do fornecedor pode ser barrado pelo navegador (http em site https, sem permissao): vai pelo servidor.
        if (direct && !working && nextRoute()) continue;
        if (++retries > 4) throw new Error("Sem conexão. Continue quando a internet voltar.");
        await new Promise((r) => setTimeout(r, 2000 * retries));
        continue;
      }
      if (res.status === 416 && d.done > 0) {
        d.size = d.done; // pediu depois do fim: arquivo completo
        break;
      }
      if (!res.ok) {
        if (!direct && res.status === 403 && (await expiredLink(res))) {
          // Link do servidor de video vencido (download longo): pede outro.
          if (++renewed > 2) throw new Error("O link do download expirou. Tente de novo.");
          routes = routesOf(await freshLink(d));
          if (i >= routes.length) i = 0;
          continue;
        }
        if (nextRoute()) continue;
        throw new Error(
          res.status === 404
            ? "Título não encontrado no servidor"
            : res.status === 401 || res.status === 403
              ? `O fornecedor da lista recusou o download (HTTP ${res.status}). Tente mais tarde ou assista online.`
              : `O servidor respondeu ${res.status}`,
        );
      }
      working = true;
      if (d.pick !== i || d.route !== (direct ? "direct" : "proxy")) {
        d = { ...d, pick: i, route: direct ? "direct" : "proxy", ext: routes[i].ext || d.ext };
        await putMeta(d);
      }
      if (res.status === 200 && d.done > 0) {
        // Fonte sem pedacos (Range): recomeca do zero.
        await removeAll(d.id);
        d = { ...d, done: 0, parts: 0 };
      }
      const total = Number(/\/(\d+)$/.exec(res.headers.get("content-range") || "")?.[1] || (res.status === 200 ? res.headers.get("content-length") : 0) || 0);
      if (total) d.size = total;
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Resposta vazia do servidor");
      const before = d.done;
      let pending: Uint8Array[] = [];
      let pendingBytes = 0;
      const flush = async () => {
        if (!pendingBytes) return;
        const blob = new Blob(pending as BlobPart[]);
        const part = d.parts;
        const next = { ...d, parts: part + 1, done: d.done + pendingBytes };
        await tx(["meta", "chunks"], "readwrite", (t) => {
          t.objectStore("chunks").put(blob, chunkKey(d.id, part));
          t.objectStore("meta").put(next);
        });
        d = next;
        setOne(d);
        pending = [];
        pendingBytes = 0;
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal.aborted) return;
        pending.push(value);
        pendingBytes += value.byteLength;
        if (pendingBytes >= CHUNK) await flush();
      }
      await flush();
      retries = 0;
      if (res.status === 200) d.size = d.done; // veio inteiro
      // Direto do fornecedor o navegador pode esconder o tamanho total: pedaco menor que o pedido = fim do arquivo.
      if (d.done === before) throw new Error("Resposta vazia do servidor");
      if (!d.size && d.done - before < CHUNK) d.size = d.done;
    }
    d = { ...d, status: "done" };
    await putMeta(d);
    setOne(d);
  } catch (err) {
    if (signal.aborted) return;
    const full = (err as Error)?.name === "QuotaExceededError" || /quota|cheio/i.test(String((err as Error)?.message));
    d = { ...d, status: "error", error: full ? "Sem espaço no aparelho." : (err as Error).message || "Falha ao baixar" };
    await putMeta(d).catch(() => {});
    setOne(d);
  }
}

// ---------- Assistir ----------
export async function openDownload(id: string): Promise<{ url: string; download: Download }> {
  await loadDownloads();
  const d = list.find((x) => x.id === id);
  if (!d || d.status !== "done") throw new Error("Download ainda não terminou");
  if (isExpired(d)) throw new Error("Este download venceu. Conecte o aparelho à internet para renovar.");
  const parts = await tx<Blob[]>(["chunks"], "readonly", (t) => t.objectStore("chunks").getAll(IDBKeyRange.bound(`${id}|`, `${id}|￿`)));
  if (!parts || parts.length !== d.parts) throw new Error("Arquivo incompleto. Apague e baixe de novo.");
  const blob = new Blob(parts, { type: MIME[d.ext] || "video/mp4" });
  return { url: URL.createObjectURL(blob), download: d };
}

// ---------- Validade ----------
/**
 * Online e logado: renova a validade dos downloads da conta. Conta bloqueada, lista vencida ou downloads
 * desligados pelo revendedor apagam tudo; outra conta no aparelho apaga os downloads da anterior.
 */
export async function renewDownloads(account: string) {
  await loadDownloads();
  await deleteDownloads((d) => d.account !== account);
  if (!list.length) return;
  try {
    const r = await api.post<{ revoked: boolean; valid_until?: string }>("/api/player/downloads/renew");
    if (r.revoked) return deleteDownloads();
    for (const d of list) {
      if (r.valid_until && d.valid_until !== r.valid_until) {
        const next = { ...d, valid_until: r.valid_until };
        await putMeta(next);
        setOne(next);
      }
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) await deleteDownloads();
  }
}

export const formatBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1).replace(".", ",")} GB` : `${Math.max(0, Math.round(n / 1024 ** 2))} MB`;
