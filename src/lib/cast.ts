import { useSyncExternalStore } from "react";
import { api, type Channel } from "@/lib/api";
import { isTV } from "@/lib/tvnav";

// "Tocar em outro aparelho": com o app aberto na TV, escolhe o titulo no celular/PC e ele toca na TV.
// Os aparelhos abertos da mesma conta conversam por um canal de mensagens (ntfy, via EventSource): nada passa pela
// Vercel nem pelo Firestore. O servidor so entrega o nome do canal e a chave da conta (/api/player/cast);
// as mensagens vao cifradas (AES-GCM), entao o servico de mensagens nao ve titulos nem links.

export type DeviceKind = "tv" | "phone" | "pc";
export type CastDevice = { id: string; name: string; kind: DeviceKind; title?: string };
export type CastAction = "toggle" | "stop" | "back" | "fwd" | "voldown" | "volup";
export type CastState = { title: string; logo: string; paused: boolean; pos: number; dur: number; live: boolean; at: number } | null;
export type CastPlay = { item: Channel; at: number; dur: number; profile: string; name: string };

type Msg = { from: string; to?: string; ts: number } & (
  | { type: "hello" }
  | { type: "here"; name: string; kind: DeviceKind; title?: string; state?: CastState }
  | ({ type: "play" } & CastPlay)
  | { type: "ctl"; a: CastAction }
  | { type: "state"; state: CastState }
);

const ID_KEY = "rtec:device";
const TARGET_KEY = "rtec:cast-target"; // { user, device }: ultimo aparelho conectado, para religar ao voltar ao app
const MAX_AGE = 60; // s: ao reconectar, o canal reenvia o que perdeu; comando mais velho que isso e ignorado
const KEEP = ["id", "name", "group", "logo", "src", "type", "kind", "epg_id", "playlist_id", "series_id", "parent_series", "xt_id", "season", "episode", "alt", "alt_type", "fallback", "more"] as const;

const deviceId = (() => {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) localStorage.setItem(ID_KEY, (id = Math.random().toString(36).slice(2, 12)));
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
})();

/** Tipo e nome deste aparelho, pelo navegador ("TV Samsung", "Celular Android", "Computador (Windows)"...). */
export function thisDevice(): { kind: DeviceKind; name: string } {
  const ua = navigator.userAgent;
  if (isTV()) {
    if (/Tizen/i.test(ua)) return { kind: "tv", name: "TV Samsung" };
    if (/Web0S|webOS|NetCast/i.test(ua)) return { kind: "tv", name: "TV LG" };
    if (/AFT[A-Z]/.test(ua)) return { kind: "tv", name: "Fire TV" };
    if (/Android/i.test(ua)) return { kind: "tv", name: "TV Box Android" };
    return { kind: "tv", name: "TV" };
  }
  if (/iPhone/i.test(ua)) return { kind: "phone", name: "iPhone" };
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return { kind: "phone", name: "iPad" };
  if (/Android/i.test(ua)) return { kind: "phone", name: /Mobile/i.test(ua) ? "Celular Android" : "Tablet Android" };
  if (/Windows/i.test(ua)) return { kind: "pc", name: "Computador (Windows)" };
  if (/Macintosh/i.test(ua)) return { kind: "pc", name: "Mac" };
  return { kind: "pc", name: "Computador" };
}

// ---------- Canal cifrado ----------
type Relay = { relay: string; topic: string; key: CryptoKey };
let chan: Promise<Relay> | null = null;
let user = "";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function channel() {
  chan ??= api.get<{ relay: string; topic: string; key: string }>("/api/player/cast").then(async (c) => ({
    relay: c.relay,
    topic: c.topic,
    key: await crypto.subtle.importKey("raw", unb64(c.key), "AES-GCM", false, ["encrypt", "decrypt"]),
  }));
  chan.catch(() => (chan = null));
  return chan;
}

async function seal(key: CryptoKey, msg: Msg) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(msg))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64(out);
}

async function open(key: CryptoKey, text: string): Promise<Msg | null> {
  try {
    const raw = unb64(text);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
    return JSON.parse(new TextDecoder().decode(pt)) as Msg;
  } catch {
    return null; // mensagem de outra conta ou corrompida
  }
}

type Body = Msg extends infer M ? (M extends Msg ? Omit<M, "from" | "ts"> : never) : never;

async function send(body: Body) {
  const c = await channel();
  // text/plain: o navegador nao precisa pedir permissao antes (CORS simples).
  const res = await fetch(`${c.relay}/${c.topic}`, { method: "POST", body: await seal(c.key, { ...body, from: deviceId, ts: Date.now() } as Msg) });
  if (!res.ok) throw new Error(`cast ${res.status}`);
}

// ---------- Estado compartilhado com a interface ----------
let target: CastDevice | null = null; // aparelho que este controla (como um Chromecast conectado)
let targetState: CastState = null;
let snapshot: { target: CastDevice | null; state: CastState } = { target, state: targetState };
const subs = new Set<() => void>();
const changed = () => {
  snapshot = { target, state: targetState };
  subs.forEach((s) => s());
};

/** Aparelho escolhido para tocar e o que esta passando nele. */
export function useCast() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => snapshot,
  );
}

export const castTarget = () => target;

export function setCastTarget(d: CastDevice | null, state: CastState = null) {
  target = d;
  targetState = state;
  changed();
  try {
    if (d) localStorage.setItem(TARGET_KEY, JSON.stringify({ user, device: d }));
    else localStorage.removeItem(TARGET_KEY);
  } catch {
    /* armazenamento indisponivel */
  }
}

function rememberedTarget(): CastDevice | null {
  try {
    const v = JSON.parse(localStorage.getItem(TARGET_KEY) || "null") as { user: string; device: CastDevice } | null;
    return v?.user === user ? v.device : null;
  } catch {
    return null;
  }
}

let resuming = false;
/** Ao abrir ou voltar ao app: se o ultimo aparelho conectado ainda esta aberto, religa sozinho (e pega o que esta passando). */
async function resume() {
  const last = target ?? rememberedTarget();
  if (!last || resuming) return;
  resuming = true;
  try {
    found = new Map();
    await send({ type: "hello", to: last.id });
    await new Promise((r) => setTimeout(r, 2500));
    const d = found.get(last.id);
    const st = states.get(last.id) ?? null;
    if (d && (!target || target.id === d.id)) setCastTarget(d, st);
  } catch {
    /* sem rede: fica como estava */
  } finally {
    found = null;
    resuming = false;
  }
}

// ---------- Quem esta aberto ----------
let found: Map<string, CastDevice> | null = null;
const states = new Map<string, CastState>(); // o que cada aparelho disse que esta passando ao responder

/** Pergunta quais aparelhos da conta estao com o app aberto (respondem em ~1 s). */
export async function findDevices(wait = 2500): Promise<CastDevice[]> {
  found = new Map();
  await send({ type: "hello" });
  await new Promise((r) => setTimeout(r, wait));
  const list = [...found.values()];
  found = null;
  const order: Record<DeviceKind, number> = { tv: 0, pc: 1, phone: 2 };
  return list.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

/** Manda o titulo tocar no aparelho escolhido (a partir de `at` segundos, para continuar de onde parou aqui). */
export async function castPlay(item: Channel, profile: string, at = 0, dur = 0) {
  if (!target) return;
  const slim = Object.fromEntries(KEEP.filter((k) => item[k] !== undefined).map((k) => [k, item[k]])) as unknown as Channel;
  await send({ type: "play", to: target.id, item: slim, at, dur, profile, name: thisDevice().name });
  targetState = { title: item.name, logo: item.logo, paused: false, pos: at, dur, live: item.kind === "live", at: Date.now() };
  changed();
}

export function castControl(a: CastAction) {
  if (!target) return Promise.resolve();
  if (a === "stop") {
    targetState = null;
    changed();
  }
  return send({ type: "ctl", to: target.id, a });
}

// ---------- Este aparelho recebendo ----------
let playHandler: ((p: CastPlay) => void) | null = null;
let nowPlaying: Channel | null = null;
let stopHandler: (() => void) | null = null;
let controller = ""; // aparelho que mandou o ultimo titulo: recebe as mudancas (pausou, fechou...)
let lastSent = "";

/** Quem decide o que fazer com um titulo recebido (troca o perfil se precisar e toca). */
export function onCastPlay(fn: (p: CastPlay) => void) {
  playHandler = fn;
  return () => {
    if (playHandler === fn) playHandler = null;
  };
}

/** O player avisa o que esta tocando neste aparelho (e como fechar), para obedecer o controle de outro aparelho. */
export function setCastNow(c: Channel | null, stop: (() => void) | null) {
  nowPlaying = c;
  stopHandler = stop;
  reportSoon();
}

const video = () => document.querySelector("video");

function stateNow(): CastState {
  if (!nowPlaying) return null;
  const v = video();
  return {
    title: nowPlaying.name,
    logo: nowPlaying.logo,
    paused: v ? v.paused : false,
    pos: v ? v.currentTime : 0,
    dur: v && Number.isFinite(v.duration) ? v.duration : 0,
    live: nowPlaying.kind === "live",
    at: Date.now(),
  };
}

/** Conta ao aparelho que controla este o que mudou (so quando muda: pausou, continuou, fechou, outro titulo). */
function report(force = false) {
  if (!controller) return;
  const s = stateNow();
  const sig = s ? `${s.title}|${s.paused}` : "";
  if (!force && sig === lastSent) return;
  lastSent = sig;
  void send({ type: "state", to: controller, state: s }).catch(() => {});
}
let reportTimer: ReturnType<typeof setTimeout> | undefined;
function reportSoon(force = false) {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => report(force), 1500);
}

function control(a: CastAction) {
  const v = video();
  if (a === "stop") stopHandler?.();
  else if (v && a === "toggle") void (v.paused ? v.play().catch(() => {}) : v.pause());
  else if (v && (a === "back" || a === "fwd")) v.currentTime = Math.max(0, v.currentTime + (a === "fwd" ? 30 : -30));
  else if (v && (a === "volup" || a === "voldown")) {
    v.muted = false;
    v.volume = Math.min(1, Math.max(0, v.volume + (a === "volup" ? 0.1 : -0.1)));
  }
  reportSoon(true);
}

async function receive(key: CryptoKey, text: string) {
  const m = await open(key, text);
  if (!m || m.from === deviceId || (m.to && m.to !== deviceId)) return;
  switch (m.type) {
    case "hello": {
      const me = thisDevice();
      void send({ type: "here", to: m.from, ...me, title: nowPlaying?.name, state: stateNow() }).catch(() => {});
      break;
    }
    case "here":
      found?.set(m.from, { id: m.from, name: m.name, kind: m.kind, title: m.title });
      states.set(m.from, m.state ?? null);
      break;
    case "play":
      controller = m.from;
      lastSent = "";
      playHandler?.(m);
      break;
    case "ctl":
      controller = m.from;
      control(m.a);
      break;
    case "state":
      if (target?.id === m.from) {
        targetState = m.state;
        changed();
      }
      break;
  }
}

function parse(data: unknown): { event?: string; message?: string; time?: number } | null {
  try {
    return typeof data === "string" ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Liga o canal da conta enquanto o app esta na tela: este aparelho aparece para os outros e obedece os comandos.
 * Devolve a funcao que desliga.
 */
export function startCast(username: string) {
  if (!window.EventSource || !window.crypto?.subtle) return () => {};
  if (user !== username) {
    chan = null;
    user = username;
  }
  let es: EventSource | null = null;
  let alive = true;
  const connect = async () => {
    if (es || !alive || document.visibilityState !== "visible") return;
    const c = await channel().catch(() => null);
    if (!c || es || !alive) return;
    es = new EventSource(`${c.relay}/${c.topic}/sse`);
    // Horario do servidor de mensagens a cada (re)conexao: o que ele reenviar de muito antes disso fica de fora.
    // (Usa o relogio dele, nao o dos aparelhos: TV costuma estar com a hora errada.)
    let since = 0;
    let resumed = false;
    const resumeOnce = () => {
      if (resumed) return;
      resumed = true;
      void resume();
    };
    es.addEventListener("open", (e) => {
      const t = parse((e as MessageEvent).data)?.time;
      if (t) {
        since = t - MAX_AGE;
        resumeOnce(); // aviso do servidor de mensagens: ja esta ouvindo
      } else setTimeout(resumeOnce, 1000); // conexao aberta (navegador)
    });
    es.onmessage = (e) => {
      const d = parse(e.data);
      if (d && (!d.event || d.event === "message") && d.message && (d.time ?? Infinity) >= since) void receive(c.key, d.message);
    };
  };
  const disconnect = () => {
    es?.close();
    es = null;
  };
  const onVisibility = () => (document.visibilityState === "visible" ? void connect() : disconnect());
  void connect();
  document.addEventListener("visibilitychange", onVisibility);
  const watch = setInterval(() => report(), 1000);
  return () => {
    alive = false;
    clearInterval(watch);
    document.removeEventListener("visibilitychange", onVisibility);
    disconnect();
    // Saiu da conta (ou trocou): desconecta sem esquecer, para religar quando a mesma conta voltar.
    target = null;
    targetState = null;
    changed();
  };
}
