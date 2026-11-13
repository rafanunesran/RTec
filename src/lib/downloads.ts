// Downloads offline: filmes e episodios guardados no aparelho (IndexedDB, em pedacos) para assistir sem internet.
// O arquivo vem pelo servidor de video (Oracle) com link cifrado; o aparelho nunca ve o link do fornecedor.
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
};

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
  const src = item.type === "file" ? item.src : item.alt_type === "file" ? item.alt : item.src;
  const link = await api.post<{ url: string; ext: string; valid_until: string }>("/api/player/downloads/link", { src, kind: item.kind });
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
  };
  if (est?.quota && est.usage !== undefined && est.quota - est.usage < 300 * 1024 * 1024) throw new Error("Pouco espaço livre no aparelho para baixar.");
  await putMeta(d);
  setOne(d);
  pump(link.url);
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
function pump(firstUrl?: string) {
  if (running) return;
  const d = list.find((x) => x.status === "queued");
  if (!d) return;
  const abort = new AbortController();
  running = { id: d.id, abort };
  void run(d, abort.signal, firstUrl).finally(() => {
    running = null;
    pump();
  });
}

async function freshLink(d: Download) {
  return (await api.post<{ url: string; valid_until: string }>("/api/player/downloads/link", { src: d.item.src, kind: d.item.kind })).url;
}

async function run(d0: Download, signal: AbortSignal, firstUrl?: string) {
  let d: Download = { ...d0, status: "downloading" };
  await putMeta(d);
  setOne(d);
  try {
    let url = firstUrl || (await freshLink(d));
    let retries = 0;
    while (!d.size || d.done < d.size) {
      const end = d.done + CHUNK - 1;
      let res: Response;
      try {
        res = await fetch(url, { headers: { Range: `bytes=${d.done}-${end}` }, signal });
      } catch (err) {
        if (signal.aborted) return;
        if (++retries > 4) throw new Error("Sem conexão. Continue quando a internet voltar.");
        await new Promise((r) => setTimeout(r, 2000 * retries));
        continue;
      }
      if (res.status === 403 && retries < 2) {
        // Link do servidor de video vencido (download longo): pede outro.
        retries++;
        url = await freshLink(d);
        continue;
      }
      if (!res.ok) throw new Error(res.status === 404 ? "Título não encontrado no servidor" : `O servidor respondeu ${res.status}`);
      if (res.status === 200 && d.done > 0) {
        // Fonte sem pedacos (Range): recomeca do zero.
        await removeAll(d.id);
        d = { ...d, done: 0, parts: 0 };
      }
      const total = Number(/\/(\d+)$/.exec(res.headers.get("content-range") || "")?.[1] || (res.status === 200 ? res.headers.get("content-length") : 0) || 0);
      if (total) d.size = total;
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Resposta vazia do servidor");
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
      if (!d.size) throw new Error("Tamanho do arquivo desconhecido");
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
