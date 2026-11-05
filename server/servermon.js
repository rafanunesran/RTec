// Monitor dos servidores dos fornecedores (Admin > Servidores): testa cada servidor usado pelas listas dos
// clientes e guarda se esta no ar, o tempo de resposta e o historico das ultimas 24 h.
// O teste e leve: pede a conta no player_api.php (o mesmo que qualquer app faz ao abrir), nao abre canal.
import { xtreamCredentials } from "./xtream.js";

export const MONITOR_EVERY_MS = 5 * 60_000; // teste automatico a cada 5 min
export const SLOW_MS = 4000; // acima disso o servidor esta "lento"
const HISTORY_MS = 24 * 3600_000;
const TIMEOUT_MS = Number(process.env.SERVER_CHECK_TIMEOUT_SECONDS || 10) * 1000;
const RETRY_DELAY_MS = 1500;
const PLAYER_UA = "VLC/3.0.20 LibVLC/3.0.20";
const PEEK_BYTES = 64 * 1024;

/** Codigos curtos do historico: 1 no ar, 2 lento, 3 com problema, 0 fora do ar. */
const CODE = { online: 1, slow: 2, problem: 3, offline: 0 };

/** Servidor (endereco) de uma lista: "http://srv:8080". Lista colada nao tem servidor. */
export function sourceOrigin(p) {
  const raw = p?.kind === "xtream" ? p.xtream_server : p?.kind === "m3u_url" ? p.url : "";
  try {
    return raw ? new URL(raw).origin.toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Servidores em uso: cada um com os clientes que dependem dele e uma lista para testar
 * (de preferencia de um cliente com a lista valendo, para o teste nao esbarrar numa conta vencida).
 */
export function serverTargets(clients, groups = []) {
  const map = new Map();
  for (const c of clients) {
    const states = c.list_status?.sources || {};
    for (const p of [c.source, ...(c.extra_sources || [])]) {
      const origin = sourceOrigin(p);
      if (!origin) continue;
      let t = map.get(origin);
      if (!t) map.set(origin, (t = { server: origin, clients: [], candidates: [] }));
      if (!t.clients.some((x) => x.id === c.id)) t.clients.push({ id: c.id, name: c.name || c.username, username: c.username });
      const expired = c.list_status?.state === "expired" || Object.values(states).some((s) => s?.state === "expired");
      t.candidates.push({ p, score: (c.active === false ? 0 : 2) + (expired ? 0 : 1) });
    }
  }
  // Irmaos sem cliente proprio: testados com os logins do grupo (os usuarios valem nos dois).
  for (const g of groups) {
    const pool = g.flatMap((s) => map.get(s)?.candidates || []);
    for (const s of g) {
      let t = map.get(s);
      if (!t) map.set(s, (t = { server: s, clients: [], candidates: [] }));
      if (!t.candidates.length) t.candidates = pool.map((x) => ({ ...x, p: moveToSibling(x.p, s) }));
    }
  }
  return [...map.values()]
    .map(({ candidates, ...t }) => ({
      ...t,
      // Ate 3 listas para testar: se um login der problema, tenta outro antes de acusar o servidor.
      probes: candidates
        .sort((a, b) => b.score - a.score)
        .map((x) => x.p)
        .slice(0, 3),
    }))
    .sort((a, b) => b.clients.length - a.clients.length || a.server.localeCompare(b.server));
}

async function peek(res) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < PEEK_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } catch {
    // corte no meio: analisa o que chegou
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

const result = (state, ms, extra = {}) => ({ state: state === "online" && ms > SLOW_MS ? "slow" : state, ms, http: 0, reason: "", ...extra });

/** Um teste: devolve { state, ms, http, reason }. */
export async function probeOnce(source, { timeoutMs = TIMEOUT_MS, fetchFn = fetch } = {}) {
  const creds = xtreamCredentials(source);
  const url = creds
    ? `${creds.server}/player_api.php?${new URLSearchParams({ username: creds.username, password: creds.password })}`
    : source?.url;
  if (!url) return result("problem", 0, { reason: "Lista sem endereço para testar" });
  const started = Date.now();
  let res;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": PLAYER_UA, Accept: "*/*" }, redirect: "follow" });
  } catch (err) {
    const timeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    const code = err?.cause?.code ? ` (${err.cause.code})` : "";
    return result("offline", Date.now() - started, {
      reason: timeout ? `Não respondeu em ${Math.round(timeoutMs / 1000)} s` : `Não foi possível conectar${code}`,
    });
  }
  const text = await peek(res);
  const ms = Date.now() - started;
  const http = res.status;
  if (http >= 500) return result("offline", ms, { http, reason: `Erro no servidor (HTTP ${http})` });
  if (http === 429) return result("problem", ms, { http, reason: "Servidor limitando os acessos (HTTP 429)" });
  if (creds) {
    if (http === 401 || http === 403) return result("online", ms, { http, reason: "Respondeu, mas recusou o login usado no teste" });
    if (!res.ok) return result("problem", ms, { http, reason: `Respondeu com erro HTTP ${http}` });
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // nao e JSON
    }
    if (!data || typeof data !== "object") return result("problem", ms, { http, reason: "Respondeu, mas não como servidor Xtream" });
    if (!data.user_info || Number(data.user_info.auth) === 0) return result("online", ms, { http, reason: "Respondeu, mas recusou o login usado no teste" });
    return result("online", ms, { http });
  }
  if (!res.ok) return result("problem", ms, { http, reason: `Respondeu com erro HTTP ${http}` });
  if (/#EXTM3U|#EXTINF/i.test(text)) return result("online", ms, { http });
  return result("problem", ms, { http, reason: text.trim() ? "O link não trouxe uma lista M3U" : "Lista vazia" });
}

/** Fora do ar: tenta mais uma vez antes de dar como fora (evita alarme por uma falha passageira). */
export async function probeServer(source, opts = {}) {
  const first = await probeOnce(source, opts);
  if (first.state !== "offline") return first;
  await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? RETRY_DELAY_MS));
  return probeOnce(source, opts);
}

/** Junta os resultados novos no documento guardado (estado atual, desde quando e historico de 24 h). */
export function recordResults(doc, results, { now = Date.now(), by = "admin" } = {}) {
  const prev = doc?.servers || {};
  const servers = {};
  const iso = new Date(now).toISOString();
  for (const [server, r] of Object.entries(results)) {
    const old = prev[server] || {};
    // Objetos (o Firestore nao aceita lista dentro de lista): t em segundos, ms do teste, c = codigo do estado.
    const history = (old.history || []).filter((x) => x.t * 1000 > now - HISTORY_MS);
    history.push({ t: Math.round(now / 1000), ms: r.state === "offline" ? -1 : r.ms, c: CODE[r.state] ?? 3 });
    const up = r.state !== "offline";
    servers[server] = {
      state: r.state,
      ms: r.ms,
      http: r.http || 0,
      reason: r.reason || "",
      checked_at: iso,
      since: old.state === r.state && old.since ? old.since : iso,
      last_ok_at: up ? iso : old.last_ok_at || null,
      last_down_at: up ? old.last_down_at || null : iso,
      history,
    };
  }
  return { checked_at: iso, checked_by: by, monitor_at: by === "monitor" ? iso : doc?.monitor_at || null, servers };
}

/** Resumo de um servidor para a tela: disponibilidade e tempo medio nas ultimas 24 h. */
export function summarize(entry) {
  const h = entry?.history || [];
  const up = h.filter((x) => x.c !== 0);
  const times = up.map((x) => x.ms).filter((ms) => ms >= 0);
  return {
    uptime: h.length ? Math.round((up.length / h.length) * 1000) / 10 : null,
    avg_ms: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    checks: h.length,
  };
}

/** Testa todos os servidores ao mesmo tempo. */
export async function checkAll(targets, opts = {}) {
  const out = {};
  await Promise.all(
    targets.map(async (t) => {
      let r = result("problem", 0, { reason: "Nenhuma lista para testar" });
      for (const p of t.probes) {
        r = await probeServer(p, opts);
        // No ar, ou fora do ar de verdade (nao conecta): nao adianta outro login.
        if (r.state === "online" && !r.reason) break;
        if (r.state === "slow" || r.state === "offline") break;
      }
      out[t.server] = r;
    }),
  );
  return out;
}

// ---------- Servidores irmaos (mesmo painel do fornecedor, enderecos diferentes) ----------

/** Endereco normalizado ("http://srv:8080") de um link ou endereco colado; "" se nao for valido. */
export function originOf(link) {
  let s = String(link || "").trim();
  if (s && !/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && u.hostname ? u.origin.toLowerCase() : "";
  } catch {
    return "";
  }
}

/** Grupos limpos: enderecos validos, sem repetir, cada servidor em um grupo so, grupos com 2 ou mais. */
export function cleanGroups(groups) {
  const seen = new Set();
  const out = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    const list = [];
    for (const s of Array.isArray(g) ? g : g?.servers || []) {
      const o = originOf(s);
      if (o && !seen.has(o)) {
        seen.add(o);
        list.push(o);
      }
    }
    if (list.length >= 2) out.push(list.slice(0, 8));
  }
  return out;
}

export const siblingsOf = (groups, server) => (groups.find((g) => g.includes(server)) || []).filter((s) => s !== server);

/**
 * Troca automatica: servidor fora do ar -> irmao que esta no ar (o mais rapido; lento so se nao houver outro).
 * Sem teste do irmao ainda, nao troca (melhor ficar no servidor conhecido).
 */
export function failoverMap(groups, servers = {}) {
  const map = new Map();
  for (const g of groups) {
    for (const s of g) {
      if (servers[s]?.state !== "offline") continue;
      const ok = g
        .filter((x) => x !== s && ["online", "slow"].includes(servers[x]?.state))
        .sort((a, b) => (servers[a].state === "online" ? 0 : 1) - (servers[b].state === "online" ? 0 : 1) || (servers[a].ms ?? 1e9) - (servers[b].ms ?? 1e9));
      if (ok.length) map.set(s, ok[0]);
    }
  }
  return map;
}

/** Troca so o servidor de um link, mantendo caminho, usuario e senha. */
export function swapOrigin(link, to) {
  try {
    const u = new URL(link);
    const t = new URL(to);
    u.protocol = t.protocol;
    u.hostname = t.hostname;
    u.port = t.port;
    return u.toString();
  } catch {
    return link;
  }
}

/** Lista com o endereco trocado para o irmao (xtream_server, url e guia). */
export function moveToSibling(p, to) {
  const from = sourceOrigin(p);
  const mv = (link) => (link && originOf(link) === from ? swapOrigin(link, to) : link);
  const next = { ...p, epg_url: mv(p.epg_url) };
  if (p.kind === "xtream") next.xtream_server = mv(p.xtream_server).replace(/\/+$/, "");
  else next.url = mv(p.url);
  return next;
}
