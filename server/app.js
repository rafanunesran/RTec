import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { DuplicateError, getStore } from "./store/index.js";
import { countChannels, headerEpgUrls, loadPlaylistText, parseEntries, sourceUrl } from "./m3u.js";
import { nowNext } from "./epg.js";
import * as xtream from "./xtream.js";
import { lookupOnline, mergeInfo } from "./titleinfo.js";
import { rankSimilar } from "./recommend.js";
import { checkSource } from "./listcheck.js";
import { episodeInfo, episodeOf, normTitle } from "./titlekey.js";
import { createCatalog, sourceKey } from "./merge.js";
import { hasDataKey, needsSeal, openUrl, sealUrl } from "./seal.js";
import { getAgenda, leagueList, matchGames } from "./games.js";
import { RETRY_FAILED_MS, cleanMarks, markKey, neighbors, theIntroDb } from "./marks.js";
import { CHECK_EVERY_MS, alertList, alertTargets, checkAlerts, cleanSeries, markSeen, readSnap, setAlert } from "./epalerts.js";

const COOKIE = "rtec_session";
const CLIENT_COOKIE = "rtec_player";
const DEFAULT_PIN = "0000";
// Categorias adultas (mesma regra do reprodutor): ficam fora dos Jogos do dia.
const ADULT_GROUP = /(adult|xxx|\+18|18\+|adulto|er[oó]tic|hot\b|sexy|porn)/i;
const MAX_MANUAL_BYTES = 900 * 1024; // um documento do Firestore aceita ate 1 MB

// "direct": o navegador busca o video na fonte (nao gasta banda do servidor).
// "proxy": o video passa pelo servidor (resolve CORS e links http, mas consome banda).
// "auto": links https vao direto; links http passam pelo servidor (o navegador bloqueia http em site https).
const DEFAULT_PLAYBACK = process.env.DEFAULT_PLAYBACK || "auto";
const PLAYBACK_MODES = ["auto", "direct", "proxy"];

function viaProxy(mode, url, app = false) {
  if (mode === "proxy") return true;
  // No app Android o video vai direto do fornecedor para o aparelho (sem limite de banda do servidor).
  if (app) return false;
  // No navegador, link http nunca toca direto: e bloqueado dentro de um site https.
  return !/^https:/i.test(url);
}

/** O app Android (WebView) se identifica com "RTecApp" no User-Agent. */
const isApp = (req) => /\bRTecApp\b/.test(req.get("user-agent") || "");
/**
 * Canais Xtream: alem do app Android, a TV Samsung (Tizen) tambem tenta direto do fornecedor. Esses canais
 * trazem o plano B pelo servidor (fallback), usado se a TV bloquear o link http.
 */
const directXtream = (req) => isApp(req) || liteDirect(req) || /\bTizen\b/.test(req.get("user-agent") || "");
/**
 * Versao leve para TVs antigas (public/tv-antiga.html, ?direct=1): o reprodutor da TV toca o link do
 * fornecedor direto, sem passar pelo servidor (que corta o ao vivo em 50 s na Vercel).
 */
const liteDirect = (req) => req.query.direct === "1";

let JWT_SECRET = process.env.JWT_SECRET || "";

// Na Vercel (funcoes de no maximo 60 s) o proxy entrega filmes em pedacos e corta o ao vivo antes do limite.
const PROXY_CHUNK_BYTES = Number(process.env.PROXY_CHUNK_MB || (process.env.VERCEL ? 8 : 0)) * 1024 * 1024;
const PROXY_MAX_SECONDS = Number(process.env.PROXY_MAX_SECONDS || (process.env.VERCEL ? 50 : 0));

const randomToken = () => crypto.randomBytes(16).toString("hex");
const randomPassword = () => crypto.randomBytes(6).toString("base64url");
const nowIso = () => new Date().toISOString();
const byName = (a, b) => a.name.localeCompare(b.name);
const newestFirst = (a, b) => String(b.created_at).localeCompare(String(a.created_at));

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function unique(fn, message = "Ja existe um cliente com esse usuario") {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DuplicateError) throw new HttpError(409, message);
    throw err;
  }
}

// ---------- Inicializacao (segredo da sessao e primeiro admin) ----------
const env = (name) => (process.env[name] || "").trim();

/**
 * Garante a conta do administrador:
 * - sem nenhum admin: cria com ADMIN_USER / ADMIN_PASSWORD. Nao ha senha padrao (o codigo e publico): sem
 *   ADMIN_PASSWORD o servidor publicado nao cria o admin; no computador (dev) sorteia uma e mostra no terminal;
 * - com ADMIN_RESET_PASSWORD: redefine a senha do ADMIN_USER uma vez para cada valor novo
 *   (serve para recuperar o acesso pela Vercel sem mexer no banco).
 */
export async function ensureAdminAccount(db) {
  const username = env("ADMIN_USER") || "admin";
  const reset = env("ADMIN_RESET_PASSWORD");
  if (reset) {
    const fingerprint = crypto.createHash("sha256").update(`${username}|${reset}`).digest("hex");
    const applied = await db.config.get("admin_reset");
    if (applied?.fingerprint !== fingerprint) {
      const hash = bcrypt.hashSync(reset, 10);
      const admin = await db.admins.findOne("username", username);
      if (admin) await db.admins.update(admin.id, { password_hash: hash });
      else await unique(() => db.admins.create({ username, password_hash: hash })).catch(() => {});
      await db.config.set("admin_reset", { fingerprint, applied_at: nowIso() });
      console.log(`[rtec] Senha do admin "${username}" redefinida por ADMIN_RESET_PASSWORD.`);
    }
    return;
  }
  const admins = await db.admins.list();
  if (admins.length > 0) return;
  const published = !!process.env.VERCEL || process.env.NODE_ENV === "production";
  if (!env("ADMIN_PASSWORD") && published) {
    console.warn("[rtec] Nenhum admin: defina ADMIN_PASSWORD nas variaveis de ambiente e faca Redeploy.");
    return;
  }
  const password = env("ADMIN_PASSWORD") || randomPassword();
  await unique(() => db.admins.create({ username, password_hash: bcrypt.hashSync(password, 10) })).catch(() => {});
  console.log(`[rtec] Admin inicial criado: ${username} / ${env("ADMIN_PASSWORD") ? "(senha de ADMIN_PASSWORD)" : `${password} (so neste computador)`}`);
}

/** Com DATA_KEY configurada, cifra os links/senhas do fornecedor que ainda estavam abertos no banco. */
async function sealStoredSources(db) {
  if (!hasDataKey()) return;
  const fingerprint = crypto.createHash("sha256").update(`seal2|${process.env.DATA_KEY.trim()}`).digest("hex").slice(0, 16);
  if ((await db.config.get("data_seal"))?.fingerprint === fingerprint) return;
  for (const [name, fields] of [["clients", ["password", "source", "extra_sources"]], ["playlists", ["url", "xtream_server", "xtream_username", "xtream_password", "epg_url"]]]) {
    // O banco cru (sem abrir), para achar o que ainda esta sem cifra.
    const raw = await Object.getPrototypeOf(db[name]).list();
    for (const doc of raw) {
      if (!needsSeal(name, doc)) continue;
      const opened = await db[name].get(doc.id);
      await db[name].update(doc.id, Object.fromEntries(fields.filter((f) => f in opened).map((f) => [f, opened[f]])));
    }
  }
  await db.config.set("data_seal", { fingerprint, sealed_at: nowIso() });
}

let ready;
function init() {
  ready ??= (async () => {
    const db = getStore();
    if (!JWT_SECRET) JWT_SECRET = await db.getOrCreateSecret(() => crypto.randomBytes(32).toString("hex"));
    await ensureAdminAccount(db);
    await sealStoredSources(db);
  })().catch((err) => {
    ready = undefined;
    throw err;
  });
  return ready;
}

// ---------- Cache curto de clientes (economiza leituras do Firestore) ----------
const CLIENT_TTL_MS = 30_000;
const clientCache = new Map();

async function getClient(id) {
  const hit = clientCache.get(id);
  if (hit && Date.now() - hit.at < CLIENT_TTL_MS) return hit.client;
  const client = await getStore().clients.get(id);
  clientCache.set(id, { at: Date.now(), client });
  return client;
}

const forgetClient = (id) => clientCache.delete(String(id));

// A validade vem da propria lista do fornecedor (ver listcheck.js), nao de uma data digitada no painel.
const isListExpired = (c) => c?.list_status?.state === "expired";

function isClientValid(c) {
  return !!c && !!c.active && !isListExpired(c);
}

const LIST_EXPIRED = "Lista expirada, entre em contato com o adm";
const BLOCKED = "Acesso bloqueado. Fale com seu revendedor.";

function assertClientAccess(c) {
  if (!c.active) throw new HttpError(403, BLOCKED, "blocked");
  if (isListExpired(c)) throw new HttpError(403, LIST_EXPIRED, "list_expired");
}

// Confere a lista no fornecedor no login e a cada abertura do app (no maximo 1x a cada 30 s por cliente).
const LIST_CHECK_TTL_MS = 30_000;
const LIST_SAVE_MS = 60 * 60_000;
const listChecks = new Map();

async function refreshListStatus(c, { force = false } = {}) {
  const last = listChecks.get(c.id);
  if (!force && last && Date.now() - last.at < LIST_CHECK_TTL_MS) return last.promise;
  const promise = (async () => {
    const list = allSources(c);
    const results = await Promise.all(list.map((p) => checkSource(p).catch((err) => ({ state: "unknown", reason: err.message }))));
    const result = combineChecks(results);
    const prev = c.list_status || null;
    // Sem lista para conferir: libera. Fornecedor fora do ar: mantem o ultimo resultado (nao bloqueia por engano).
    const state = !result ? "none" : result.state === "unknown" ? prev?.state || "unknown" : result.state;
    const next = {
      state,
      reason: result?.state === "unknown" && prev?.state ? prev.reason || "" : result?.reason || "",
      checked_at: result?.state === "unknown" ? prev?.checked_at || null : nowIso(),
      last_error: result?.state === "unknown" ? result.reason : "",
      provider_status: result?.provider_status ?? prev?.provider_status ?? "",
    };
    // Varias listas: o estado de cada uma (as vencidas saem do catalogo, as outras continuam valendo).
    if (list.length > 1) {
      next.sources = Object.fromEntries(
        list.map((p, i) => {
          const key = sourceKey(p);
          const r = results[i];
          return [key, !r ? "none" : r.state === "unknown" ? prev?.sources?.[key] || "unknown" : r.state];
        }),
      );
    }
    const patch = { list_status: next };
    if (result && result.state !== "unknown" && "expires_at" in result) patch.expires_at = result.expires_at;
    else if (result && result.state !== "unknown") patch.expires_at = null;
    else if (!result) patch.expires_at = null;
    const changed =
      !prev ||
      prev.state !== next.state ||
      prev.reason !== next.reason ||
      prev.last_error !== next.last_error ||
      JSON.stringify(prev.sources || null) !== JSON.stringify(next.sources || null) ||
      ("expires_at" in patch && (patch.expires_at ?? null) !== (c.expires_at ?? null)) ||
      Date.now() - new Date(prev.checked_at || 0).getTime() > LIST_SAVE_MS;
    Object.assign(c, patch);
    if (changed) await getStore().clients.update(c.id, patch);
    if (prev?.state !== next.state) console.log(`[rtec] Lista do cliente "${c.username}": ${prev?.state || "-"} -> ${next.state}${next.reason ? ` (${next.reason})` : ""}`);
    return next;
  })();
  listChecks.set(c.id, { at: Date.now(), promise });
  promise.catch(() => listChecks.delete(c.id));
  return promise;
}

/**
 * Junta a conferencia de varias listas: basta uma valer para o cliente continuar assistindo.
 * Uma lista sem o que conferir (colada) tambem vale. Com uma lista so, e o resultado dela.
 */
function combineChecks(results) {
  if (results.length <= 1) return results[0] ?? null;
  const real = results.filter(Boolean);
  if (!real.length) return null;
  const active = real.filter((r) => r.state === "active");
  if (active.length || real.length < results.length) {
    const dates = active.map((r) => r.expires_at || null);
    const expires_at = !active.length || dates.includes(null) ? null : dates.sort().at(-1);
    return { state: "active", reason: "", expires_at, provider_status: active[0]?.provider_status || "Active" };
  }
  return real.find((r) => r.state === "unknown") || real[0];
}

const MAX_LISTS = 5;

/** Servidor (endereco) de uma lista do fornecedor: "http://srv:8080". Lista colada nao tem servidor. */
function sourceServer(p) {
  const raw = p?.kind === "xtream" ? p.xtream_server : p?.kind === "m3u_url" ? p.url : "";
  try {
    return raw ? new URL(raw).origin.toLowerCase() : "";
  } catch {
    return "";
  }
}

/** Troca so o servidor de um link, mantendo caminho, usuario e senha: http://velho/get.php?... -> http://novo/get.php?... */
function moveLink(link, from, to) {
  if (!link) return link;
  let u;
  try {
    u = new URL(link);
  } catch {
    return link;
  }
  if (u.origin.toLowerCase() !== from) return link;
  const t = new URL(to);
  u.protocol = t.protocol;
  u.hostname = t.hostname;
  u.port = t.port; // vazio = porta padrao (sem isso a porta antiga continuaria no link)
  return u.toString();
}

/** Lista com o servidor trocado (ou a mesma, se ela for de outro servidor). */
function moveSource(p, from, to) {
  if (!p?.kind || sourceServer(p) !== from) return p;
  const next = { ...p, epg_url: moveLink(p.epg_url, from, to) };
  if (p.kind === "xtream") next.xtream_server = moveLink(p.xtream_server, from, to).replace(/\/+$/, "");
  else next.url = moveLink(p.url, from, to);
  return next;
}

/** Listas do cliente: a principal (source) e as extras (extra_sources), que completam o catalogo. */
function allSources(c) {
  return [c.source, ...(c.extra_sources || [])].filter((p) => p?.kind);
}

/** Listas em uso: as que o fornecedor deu como vencidas saem (se ainda sobrar alguma). */
function activeSources(c) {
  const all = allSources(c);
  const states = c.list_status?.sources || {};
  const ok = all.filter((p) => states[sourceKey(p)] !== "expired");
  return ok.length ? ok : all;
}

/** Catalogo no formato Xtream (lista principal Xtream), juntando as listas extras. null: lista M3U comum. */
function catalogFor(c) {
  const srcs = activeSources(c);
  return srcs.length && xtream.xtreamCredentials(srcs[0]) ? createCatalog(srcs) : null;
}

/** Atualiza "ultimo acesso" no maximo a cada 5 minutos, para nao gastar gravacoes. */
async function touch(collection, doc, field) {
  if (doc[field] && Date.now() - new Date(doc[field]).getTime() < 5 * 60_000) return;
  doc[field] = nowIso();
  await getStore()[collection].update(doc.id, { [field]: doc[field] });
}

// Muda quando a senha do cliente muda, derrubando sessoes antigas do reprodutor.
const passwordFingerprint = (c) => crypto.createHash("sha256").update(c.password).digest("hex").slice(0, 16);

// Links do proxy assinados com validade: funcionam sem cookie, inclusive num servidor de video separado
// (STREAM_PROXY_URL, ex: Oracle Cloud), que confere a assinatura com o mesmo PROXY_SECRET.
const LINK_TTL_SECONDS = 12 * 3600;
const proxySecret = () => process.env.PROXY_SECRET || JWT_SECRET;
const proxyBase = () => (process.env.STREAM_PROXY_URL || "").replace(/\/+$/, "");

function signUrl(clientId, exp, url) {
  return crypto.createHmac("sha256", proxySecret()).update(`${clientId}|${exp}|${url}`).digest("base64url").slice(0, 32);
}

function verifySignature(clientId, exp, url, sig, { allowExpired = false } = {}) {
  if (!clientId || !Number(exp) || (!allowExpired && !(Number(exp) > Date.now() / 1000))) return false;
  const expected = Buffer.from(signUrl(clientId, exp, url));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/**
 * O link do fornecedor vai cifrado no link do proxy (o aparelho nao ve usuario/senha). Servidor de video
 * separado (STREAM_PROXY_URL) instalado antes desta versao so entende o link aberto: cifra la so com PROXY_ENCRYPT=1.
 */
const sealLinks = (base) => !base || process.env.PROXY_ENCRYPT === "1";

function proxyUrl(clientId, url, base = proxyBase()) {
  // Validade arredondada para a hora: o mesmo link se repete e aproveita cache do navegador.
  const exp = Math.ceil((Date.now() / 1000 + LINK_TTL_SECONDS) / 3600) * 3600;
  const u = sealLinks(base) ? sealUrl(proxySecret(), url) : url;
  const q = new URLSearchParams({ u, c: clientId, e: String(exp), s: signUrl(clientId, exp, u) });
  return `${base}/api/player/proxy?${q}`;
}

/** URL do fornecedor de um link do proxy (cifrado ou, nos links antigos, aberto); "" se nao for valido. */
function proxyTarget(u, c, e, s, opts) {
  if (!u || !verifySignature(c, e, u, s || "", opts)) return "";
  const url = /^https?:\/\//i.test(u) ? u : openUrl(proxySecret(), u);
  return /^https?:\/\//i.test(url) ? url : "";
}

function streamType(url, kind = "") {
  const pathname = url.split(/[?#]/)[0].toLowerCase();
  if (pathname.endsWith(".m3u8")) return "hls";
  if (/\.(mp4|mkv|webm|mov|m4v|mp3|aac|ogg|oga|opus|m4a)$/.test(pathname)) return "file";
  // Radio sem extensao (Icecast/Shoutcast, ex: http://host:8000/stream): o proprio navegador toca o audio.
  if (kind === "radio" && !pathname.endsWith(".ts")) return "file";
  return "mpegts";
}

/** Reescreve uma playlist HLS para que segmentos, chaves e sub-playlists passem pelo proxy. */
function rewriteHls(text, baseUrl, clientId, base) {
  const abs = (u) => new URL(u, baseUrl).toString();
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${proxyUrl(clientId, abs(u), base)}"`);
      return proxyUrl(clientId, abs(t), base);
    })
    .join("\n");
}

function clientProfile(c) {
  return { name: c.name, username: c.username, expires_at: c.expires_at };
}

// Publicado (Vercel), o cookie de sessao so viaja por https.
const secureCookie = (req) => req.secure || !!process.env.VERCEL;

// Sessoes do painel e do reprodutor usam o mesmo segredo: o campo "typ" impede que o cookie de um cliente
// sirva de cookie de administrador (e vice-versa).
const JWT_OPTS = { algorithms: ["HS256"] };

function signClientSession(res, req, c) {
  const token = jwt.sign({ typ: "player", cid: c.id, pw: passwordFingerprint(c) }, JWT_SECRET, { expiresIn: "30d" });
  res.cookie(CLIENT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookie(req), maxAge: 30 * 24 * 3600 * 1000 });
}

// Muda quando a senha do admin muda (inclusive por ADMIN_RESET_PASSWORD), derrubando as sessoes antigas do painel.
const adminFingerprint = (a) => crypto.createHash("sha256").update(`admin|${a.password_hash}`).digest("hex").slice(0, 16);

function signAdminSession(res, req, admin) {
  const token = jwt.sign({ typ: "admin", id: admin.id, username: admin.username, pw: adminFingerprint(admin) }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: secureCookie(req), maxAge: 7 * 24 * 3600 * 1000 });
}

// Cache curto do admin (o painel faz varias chamadas seguidas; economiza leituras do Firestore).
const adminCache = new Map();
async function getAdmin(id) {
  const hit = adminCache.get(id);
  if (hit && Date.now() - hit.at < CLIENT_TTL_MS) return hit.admin;
  const admin = await getStore().admins.get(id);
  adminCache.set(id, { at: Date.now(), admin });
  return admin;
}

const requireAdmin = wrap(async (req, _res, next) => {
  let payload;
  try {
    payload = jwt.verify(req.cookies[COOKIE], JWT_SECRET, JWT_OPTS);
  } catch {
    throw new HttpError(401, "Nao autenticado");
  }
  if (payload.typ !== "admin" || !payload.id) throw new HttpError(401, "Nao autenticado");
  const admin = await getAdmin(String(payload.id));
  if (!admin || payload.pw !== adminFingerprint(admin)) throw new HttpError(401, "Sessao expirada, entre novamente");
  req.admin = { id: admin.id, username: admin.username };
  next();
});

/** Cookie do reprodutor: so vale token de cliente (nunca o do painel). */
function clientPayload(req) {
  try {
    const payload = jwt.verify(req.cookies[CLIENT_COOKIE], JWT_SECRET, JWT_OPTS);
    // Sessoes de antes do campo "typ" continuam valendo (tem cid e nao sao do painel).
    if ((payload.typ ?? "player") === "player" && typeof payload.cid === "string" && payload.cid) return payload;
  } catch {
    /* sem sessao */
  }
  throw new HttpError(401, "Nao autenticado");
}

const requireClient = wrap(async (req, _res, next) => {
  const payload = clientPayload(req);
  const c = await getClient(payload.cid);
  if (!c || payload.pw !== passwordFingerprint(c)) throw new HttpError(401, "Sessao expirada, entre novamente");
  assertClientAccess(c);
  req.client = c;
  next();
});

/** Sessao do reprodutor sem barrar lista expirada (para conferir de novo na abertura do app). */
const clientSession = wrap(async (req, _res, next) => {
  const payload = clientPayload(req);
  const c = await getClient(payload.cid);
  if (!c || payload.pw !== passwordFingerprint(c)) throw new HttpError(401, "Sessao expirada, entre novamente");
  req.client = c;
  next();
});

async function clientPlaylists(c) {
  const db = getStore();
  const own = activeSources(c).map((p, i) => ({ ...p, id: i ? `own-${c.id}-${sourceKey(p)}` : `own-${c.id}`, name: c.name || c.username, active: true }));
  const shared = await Promise.all((c.playlist_ids || []).map((id) => db.playlists.get(id)));
  return [...own, ...shared.filter((p) => p && p.active).sort(byName)];
}

function serializeClient(c) {
  const { parental_pin_hash, locked_groups: _locked, token: _token, ...rest } = c;
  return { ...rest, playlist_ids: c.playlist_ids || [], valid: isClientValid(c), custom_pin: !!parental_pin_hash };
}

function str(v, field, { required = false, max = 2000 } = {}) {
  const s = v == null ? "" : String(v).trim();
  if (required && !s) throw new HttpError(400, `Campo obrigatorio: ${field}`);
  if (s.length > max) throw new HttpError(400, `Campo muito longo: ${field}`);
  return s;
}

function baseUrl(req) {
  return process.env.PUBLIC_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
}

function clientLinks(req) {
  const base = baseUrl(req);
  return { server: base };
}

/** Compara senhas sem vazar pelo tempo de resposta quantos caracteres bateram. */
function sameText(a, b) {
  const x = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const y = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(x, y);
}

async function findClientByLogin(username, password) {
  const c = await getStore().clients.findOne("username", String(username || ""));
  if (!c || !sameText(c.password, String(password || ""))) return null;
  return c;
}

/** Valida a fonte de canais: URL M3U, login Xtream ou conteudo M3U colado. */
function readSource(body, existing) {
  const kind = str(body.kind ?? existing?.kind, "tipo", { required: true });
  if (!["m3u_url", "xtream", "manual"].includes(kind)) throw new HttpError(400, "Tipo de lista invalido");
  const playback = str(body.playback ?? existing?.playback ?? DEFAULT_PLAYBACK, "reproducao");
  if (!PLAYBACK_MODES.includes(playback)) throw new HttpError(400, "Modo de reproducao invalido");
  const p = {
    kind,
    url: str(body.url ?? existing?.url, "url"),
    xtream_server: str(body.xtream_server ?? existing?.xtream_server, "servidor"),
    xtream_username: str(body.xtream_username ?? existing?.xtream_username, "usuario xtream"),
    xtream_password: str(body.xtream_password ?? existing?.xtream_password, "senha xtream"),
    content: String(body.content ?? existing?.content ?? ""),
    epg_url: str(body.epg_url ?? existing?.epg_url, "epg"),
    playback,
  };
  if (kind === "m3u_url" && !/^https?:\/\//i.test(p.url)) throw new HttpError(400, "Informe uma URL M3U valida (http/https)");
  if (kind === "xtream" && (!/^https?:\/\//i.test(p.xtream_server) || !p.xtream_username || !p.xtream_password)) {
    throw new HttpError(400, "Informe servidor (http/https), usuario e senha do Xtream");
  }
  if (kind === "manual" && !/#EXTINF/i.test(p.content)) throw new HttpError(400, "Cole um conteudo M3U valido (com #EXTINF)");
  if (kind !== "manual") p.content = "";
  if (kind !== "m3u_url") p.url = "";
  if (kind !== "xtream") p.xtream_server = p.xtream_username = p.xtream_password = "";
  if (Buffer.byteLength(p.content) > MAX_MANUAL_BYTES) {
    throw new HttpError(400, "Lista colada muito grande (limite ~900 KB). Use o link M3U do fornecedor.");
  }
  return p;
}

async function previewSource(p) {
  // Xtream: confere a conta e conta as categorias pela API (rapido), sem baixar a lista inteira.
  const creds = xtream.xtreamCredentials(p);
  if (creds) {
    try {
      const [account, live, movie, series] = await Promise.all([
        xtream.accountInfo(creds),
        ...["live", "movie", "series"].map((s) => xtream.categories(creds, s)),
      ]);
      return { ok: true, xtream: { ...account, categories: { live: live.length, movie: movie.length, series: series.length } } };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  try {
    const text = await loadPlaylistText(p);
    const all = parseEntries(text, Infinity);
    const kinds = { live: 0, radio: 0, movie: 0, series: 0 };
    all.forEach((e) => kinds[e.kind]++);
    const groups = [...new Set(all.map((e) => e.group).filter(Boolean))];
    return { ok: true, source: sourceUrl(p), channel_count: countChannels(text), kinds, groups, entries: all.slice(0, 100) };
  } catch (err) {
    return { ok: false, source: sourceUrl(p), error: err.message };
  }
}

const MAX_M3U_ITEMS = 20000;
const RADIO_WAIT_MS = 8000;

/** Logos https vao direto; http passam pelo servidor (imagens sao pequenas). */
const logoUrl = (clientId, url) => (!/^https?:\/\//i.test(url || "") ? "" : /^https:/i.test(url) ? url : proxyUrl(clientId, url));

/** Ordenacoes do catalogo. "" = ordem do fornecedor. Sem dado (ano/nota 0) vai para o fim. */
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const SORTS = {
  az: (a, b) => collator.compare(a.name, b.name),
  za: (a, b) => collator.compare(b.name, a.name),
  recent: (a, b) => (b.added || 0) - (a.added || 0),
  oldest: (a, b) => (a.added || Infinity) - (b.added || Infinity),
  year_desc: (a, b) => (b.year || 0) - (a.year || 0) || collator.compare(a.name, b.name),
  year_asc: (a, b) => (a.year || Infinity) - (b.year || Infinity) || collator.compare(a.name, b.name),
  rating: (a, b) => (b.rating || 0) - (a.rating || 0) || collator.compare(a.name, b.name),
};
const sortItems = (list, sort) => (SORTS[sort] ? [...list].sort(SORTS[sort]) : list);

/**
 * Generos de um filme/serie. Quando o fornecedor nao manda (comum em filmes), usa o fim do nome da
 * categoria: "Filmes | Animacao" -> "Animacao".
 */
function genreList(it, categoryName) {
  const own = String(it.genre || "").split(/\s*[,/|&]\s*/).map((g) => g.trim()).filter(Boolean);
  if (own.length) return [...new Set(own)].slice(0, 6);
  const m = /[|:\-–]\s*([^|:\-–]+?)\s*$/.exec(String(categoryName || ""));
  return m ? [m[1]] : [];
}

/** Filtros extras do catalogo: g = generos (virgula), y1/y2 = de/ate o ano, r = nota minima. */
function readFilters(q) {
  const g = new Set(String(q.g || "").split(",").map((x) => fold(x.trim())).filter(Boolean));
  const y1 = Number(q.y1) || 0;
  const y2 = Number(q.y2) || 0;
  const r = Number(q.r) || 0;
  return g.size || y1 || y2 || r ? { g, y1, y2, r } : null;
}
const passesFilters = (f, it) =>
  (!f.g.size || it.genres.some((x) => f.g.has(fold(x)))) &&
  (!f.y1 || it.year >= f.y1) &&
  (!f.y2 || (it.year > 0 && it.year <= f.y2)) &&
  (!f.r || it.rating >= f.r);

/** Minusculas e sem acentos, para a busca achar "acao" em "Ação". */
const fold = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Identifica a lista Xtream do cliente (servidor e usuario): muda quando o link e trocado. */
const listSig = (creds) => hashId(creds.server.toLowerCase(), creds.username, creds.password);

const hashId = (...parts) => crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);

/** Links de video de um item (direto ou pelo servidor, conforme o modo da lista), com os planos B. */
function playLinks(c, item, p, app) {
  const mode = p?.playback || DEFAULT_PLAYBACK;
  const link = (url) => (viaProxy(mode, url, app) ? proxyUrl(c.id, url) : url);
  return {
    src: link(item.url),
    type: streamType(item.url, item.kind),
    alt: item.alt_url ? link(item.alt_url) : "",
    alt_type: item.alt_url ? streamType(item.alt_url, item.kind) : "",
    // Ultimo recurso: se o link direto (app) falhar, tenta pelo servidor de video.
    fallback: !viaProxy(mode, item.url, app) ? proxyUrl(c.id, item.url) : "",
  };
}

const MAX_MORE = 4;

/**
 * Converte um item do catalogo no formato de canal usado pelo reprodutor. srcs: listas do catalogo (o item diz
 * de qual veio em _i). "more": o mesmo titulo nas outras listas do cliente, tentado se este nao tocar.
 */
function xtreamChannel(c, item, group, app = false, srcs = [c.source]) {
  const i = item._i || 0;
  const p = srcs[i] || {};
  const pre = i ? `${p.key}~` : "";
  if (item.kind === "series" && item.series_id) {
    return { id: `s${pre}${item.series_id}`, series_id: pre + item.series_id, name: item.name, group, logo: logoUrl(c.id, item.logo), src: "", type: "file", alt: "", alt_type: "", kind: "series", epg_id: "", playlist_id: "own", added: item.added, year: item.year, rating: item.rating, genres: item.genres || [] };
  }
  const alts = (item._alts || []).filter((a) => a.url);
  const versions = item.kind === "live" || item.kind === "radio" ? null : versionsOf(c, item, alts, srcs, app);
  // Versao "cinema" so toca se for escolhida: com outra versao, a outra e a padrao.
  const main = versions && isCinema(item._tag) ? versions.find((v) => !isCinema(v.tag)) : null;
  const tag = main ? main.tag : item._tag || "|";
  const more = main ? main.more || [] : (versions ? alts.filter((a) => (a._tag || "|") === tag) : alts).slice(0, MAX_MORE).map((a) => playLinks(c, a, srcs[a._i], app));
  return {
    id: i ? hashId(c.id, p.key, item.kind, item.stream_id) : hashId(c.id, item.kind, item.stream_id),
    name: item.name,
    group,
    logo: logoUrl(c.id, item.logo || (item._alts || []).find((a) => a.logo)?.logo),
    ...playLinks(c, item, p, app),
    ...(main ? { src: main.src, type: main.type, alt: main.alt, alt_type: main.alt_type, fallback: main.fallback } : {}),
    kind: item.kind,
    // Lista M3U comum: guia pelo tvg-id (XMLTV); Xtream: pela API do fornecedor.
    epg_id: item.kind !== "live" ? "" : item.tvg_id != null ? item.tvg_id : `xt:${pre}${item.stream_id}`,
    playlist_id: "own",
    ...(item.kind === "movie" ? { xt_id: pre + item.stream_id } : {}),
    ...(item.added ? { added: item.added } : {}),
    ...(item.year ? { year: item.year } : {}),
    ...(item.rating ? { rating: item.rating } : {}),
    ...(item.genres?.length ? { genres: item.genres } : {}),
    ...(item.season ? { season: item.season, episode: item.episode } : {}),
    ...(item.cover ? { cover: logoUrl(c.id, item.cover) } : {}),
    ...(more.length ? { more } : {}),
    ...(versions ? { tag, versions } : {}),
  };
}

const isCinema = (tag) => String(tag || "").endsWith("|CINEMA");

/** "L|4K" -> "Legendado · 4K". Mostra so o que muda entre as versoes do titulo. */
function versionLabel(tag, langs, quals) {
  const [lang, q] = tag.split("|");
  const parts = [];
  if (langs) parts.push(lang === "L" ? "Legendado" : "Dublado");
  if (quals) parts.push(q === "CINEMA" ? "Cinema" : q || "Normal");
  return parts.join(" · ");
}

/**
 * Filme/episodio com mais de uma versao (dublado, legendado, 4K...): uma entrada por versao, com os links dela e
 * as reservas da mesma versao. null quando so existe uma versao.
 */
function versionsOf(c, item, alts, srcs, app) {
  const all = [item, ...alts];
  const tags = [...new Set(all.map((a) => a._tag || "|"))].sort((a, b) => isCinema(a) - isCinema(b));
  if (tags.length < 2) return null;
  const langs = new Set(tags.map((t) => t.split("|")[0])).size > 1;
  const quals = new Set(tags.map((t) => t.split("|")[1])).size > 1;
  return tags.map((tag) => {
    const [first, ...rest] = all.filter((a) => (a._tag || "|") === tag);
    const more = rest.slice(0, MAX_MORE).map((a) => playLinks(c, a, srcs[a._i], app));
    return { tag, label: versionLabel(tag, langs, quals), ...playLinks(c, first, srcs[first._i], app), ...(more.length ? { more } : {}) };
  });
}

/** Chave para achar o mesmo titulo em outra lista: tipo + nome normalizado (episodio: serie + temporada + numero). */
function channelKey(ch) {
  if (ch.kind === "series") {
    const ep = episodeInfo(ch.name);
    if (ep) return `e|${normTitle(ep.series)}|${ep.season}|${ep.episode}`;
  }
  const n = normTitle(ch.name);
  return n ? `${ch.kind}|${n}` : "";
}
const yearInName = (name) => Number(/\((19|20)\d{2}\)/.exec(String(name))?.[0].slice(1, 5)) || 0;

/**
 * Listas M3U do mesmo cliente: o titulo que ja veio de uma lista nao se repete; os links das outras listas
 * viram reserva ("more"). Dentro de uma mesma lista nada e juntado.
 */
function mergeOwnChannels(channels, own, mainId) {
  if (own.size < 2) return channels;
  const out = [];
  const byKey = new Map();
  for (const ch of channels) {
    if (!own.has(ch.playlist_id)) {
      out.push(ch);
      continue;
    }
    const k = channelKey(ch);
    const y = yearInName(ch.name);
    const pid = ch.playlist_id;
    const hit = k && (byKey.get(k) || []).find((e) => e.pid !== pid && (!e.y || !y || e.y === y));
    if (hit) {
      const more = (hit.ch.more ||= []);
      if (more.length < MAX_MORE) more.push({ src: ch.src, type: ch.type, alt: ch.alt, alt_type: ch.alt_type, fallback: "" });
      if (!hit.ch.logo && ch.logo) hit.ch.logo = ch.logo;
      continue;
    }
    // Some no seletor de listas: tudo do cliente aparece como a lista principal.
    if (mainId && ch.playlist_id !== mainId && own.has(mainId)) ch.playlist_id = mainId;
    out.push(ch);
    if (k) (byKey.get(k) || byKey.set(k, []).get(k)).push({ ch, y, pid });
  }
  return out;
}

function requireXtream(c) {
  const cat = catalogFor(c);
  if (!cat) throw new HttpError(400, "A lista deste cliente nao e Xtream");
  return cat;
}

// ---------- Sincronizacao entre aparelhos ----------
// Um documento por cliente (colecao player_sync), fora do cadastro, para nao invalidar o cache de clientes.
const MAX_FAVORITES = 500;
const MAX_HISTORY = 60;
const MAX_PROGRESS = 400;
const MAX_SYNC_BYTES = 900 * 1024; // um documento do Firestore aceita ate 1 MB
const CHANNEL_TEXT = ["id", "name", "group", "logo", "src", "type", "kind", "epg_id", "playlist_id", "series_id", "parent_series", "cover", "alt", "alt_type", "fallback", "xt_id"];

/** Guarda so os campos conhecidos de um canal/filme/serie vindo do aparelho. */
function cleanChannel(c) {
  if (!c || typeof c !== "object" || typeof c.id !== "string" || !c.id) return null;
  const out = {};
  for (const k of CHANNEL_TEXT) if (typeof c[k] === "string") out[k] = c[k].slice(0, 2000);
  for (const k of ["season", "episode"]) if (Number.isFinite(c[k])) out[k] = c[k];
  // Reservas de outras listas do cliente (mesmo titulo), para o historico tocar mesmo se uma lista cair.
  if (Array.isArray(c.more)) {
    const more = c.more
      .slice(0, MAX_MORE)
      .map((m) => (m && typeof m.src === "string" ? Object.fromEntries(["src", "type", "alt", "alt_type", "fallback"].map((k) => [k, typeof m[k] === "string" ? m[k].slice(0, 2000) : ""])) : null))
      .filter(Boolean);
    if (more.length) out.more = more;
  }
  return out;
}

const dedupe = (items) => items.filter((c, i) => items.findIndex((o) => o.id === c.id) === i);

function cleanProgress(p) {
  const [pos, dur, t] = [Number(p?.p), Number(p?.d), Number(p?.t)];
  if (![pos, dur, t].every(Number.isFinite) || dur <= 0 || pos < 0) return null;
  return { p: Math.round(Math.min(pos, Number.MAX_SAFE_INTEGER)), d: Math.round(dur), t: Math.round(t) };
}

// ---------- Perfis da conta (como na Netflix) ----------
// Cada conta tem ate 5 perfis, cada um com seus favoritos, historico e progresso.
// O perfil "main" usa o documento de sincronizacao que ja existia (dados antigos viram dele).
const MAIN_PROFILE = "main";
const MAX_PROFILES = 5;
const AVATARS = 12;

const syncDocId = (clientId, profileId) => (profileId === MAIN_PROFILE ? clientId : `${clientId}__${profileId}`);

async function loadProfiles(c) {
  const doc = await getStore().profiles.get(c.id);
  if (doc?.list?.length) return doc.list;
  return [{ id: MAIN_PROFILE, name: (c.name || c.username || "Principal").slice(0, 20), avatar: 0, kids: false }];
}

function readProfileBody(body, existing = {}) {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 20) : existing.name;
  if (!name) throw new HttpError(400, "Informe o nome do perfil");
  const avatar = Number.isInteger(body.avatar) && body.avatar >= 0 && body.avatar < AVATARS ? body.avatar : (existing.avatar ?? 0);
  const kids = typeof body.kids === "boolean" ? body.kids : !!existing.kids;
  return { name, avatar, kids };
}

/** Perfil pedido pelo aparelho (?profile=); sem perfil vale o principal (apps antigos). */
async function requestProfile(req) {
  const id = String(req.query.profile || MAIN_PROFILE);
  const list = await loadProfiles(req.client);
  if (!list.some((p) => p.id === id)) throw new HttpError(404, "Perfil nao encontrado");
  return id;
}

async function loadSync(docId) {
  const doc = (await getStore().sync.get(docId)) || {};
  return {
    favorites: doc.favorites || [],
    favorites_t: doc.favorites_t || 0,
    history: doc.history || [],
    history_t: doc.history_t || 0,
    progress: doc.progress || {},
  };
}

// Muitas senhas erradas seguidas do mesmo endereco: espera um pouco (dificulta adivinhar senhas).
const LOGIN_MAX_FAILS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFails = new Map();
function assertLoginAllowed(req, scope, who = req.ip) {
  const f = loginFails.get(`${scope}|${who}`);
  if (f && Date.now() - f.at < LOGIN_WINDOW_MS && f.count >= LOGIN_MAX_FAILS) {
    throw new HttpError(429, "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.");
  }
}
function loginFailed(req, scope, who = req.ip) {
  const k = `${scope}|${who}`;
  const f = loginFails.get(k);
  loginFails.set(k, f && Date.now() - f.at < LOGIN_WINDOW_MS ? { at: f.at, count: f.count + 1 } : { at: Date.now(), count: 1 });
  if (loginFails.size > 5000) loginFails.delete(loginFails.keys().next().value);
}

const pinMatches = (c, pin) => (c.parental_pin_hash ? bcrypt.compareSync(String(pin || ""), c.parental_pin_hash) : String(pin || "") === DEFAULT_PIN);

/** PIN parental: 8 erros seguidos na conta travam o PIN por 15 minutos (4 numeros se adivinham rapido). */
function checkPin(req, pin) {
  assertLoginAllowed(req, "pin", req.client.id);
  if (pinMatches(req.client, pin)) return true;
  loginFailed(req, "pin", req.client.id);
  return false;
}

export function createApp() {
  const app = express();
  app.set("trust proxy", true);
  // Cabecalhos de seguranca tambem nas respostas da API (o resto do site recebe os mesmos pelo vercel.json).
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    next();
  });
  app.use(express.json({ limit: "4mb" }));
  app.use(cookieParser());
  app.use(wrap(async (_req, _res, next) => (await init(), next())));

  const db = () => getStore();

  // ---------- Autenticacao do administrador ----------
  app.post(
    "/api/auth/login",
    wrap(async (req, res) => {
      assertLoginAllowed(req, "admin");
      const username = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "");
      let admin = await db().admins.findOne("username", username);
      if (!admin && (await db().admins.list()).length === 0) {
        // Admin apagado no Firestore com o servidor ja rodando: recria na hora.
        await ensureAdminAccount(db());
        admin = await db().admins.findOne("username", username);
        if (!admin && (await db().admins.list()).length === 0) {
          throw new HttpError(503, "Painel sem administrador: defina ADMIN_PASSWORD nas variaveis da Vercel e faca Redeploy.");
        }
      }
      if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
        loginFailed(req, "admin");
        console.warn(`[rtec] Login de admin recusado para "${username}": ${admin ? "senha incorreta" : "usuario nao existe"}`);
        throw new HttpError(401, "Usuario ou senha invalidos");
      }
      adminCache.delete(admin.id);
      signAdminSession(res, req, admin);
      res.json({ id: admin.id, username: admin.username });
    }),
  );

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAdmin, (req, res) => res.json(req.admin));

  app.post(
    "/api/auth/password",
    requireAdmin,
    wrap(async (req, res) => {
      const { current, next } = req.body || {};
      const admin = await db().admins.get(req.admin.id);
      if (!admin || !bcrypt.compareSync(String(current || ""), admin.password_hash)) {
        throw new HttpError(400, "Senha atual incorreta");
      }
      if (String(next || "").length < 10) throw new HttpError(400, "A nova senha precisa ter ao menos 10 caracteres");
      const updated = await db().admins.update(admin.id, { password_hash: bcrypt.hashSync(String(next), 10) });
      adminCache.delete(admin.id);
      // As outras sessoes do painel caem; esta continua com um cookie novo.
      signAdminSession(res, req, updated);
      res.json({ ok: true });
    }),
  );

  // Situacao do servidor de video (STREAM_PROXY_URL): ffmpeg, analises de Pular intro e atualizacoes.
  app.get(
    "/api/admin/video-server",
    requireAdmin,
    wrap(async (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const base = proxyBase();
      if (!base) return res.json({ configured: false });
      const exp = Math.ceil(Date.now() / 1000) + 300;
      const q = new URLSearchParams({ c: "admin", e: String(exp), s: signUrl("admin", exp, "status") });
      const host = new URL(base).host;
      try {
        const r = await fetch(`${base}/api/player/status?${q}`, { signal: AbortSignal.timeout(15000) });
        if (r.status === 404) return res.json({ configured: true, host, ok: false, error: "O servidor ainda esta na versao antiga (a atualizacao automatica troca em ate 15 min)." });
        if (!r.ok) return res.json({ configured: true, host, ok: false, error: `O servidor respondeu HTTP ${r.status}` });
        res.json({ configured: true, host, ...(await r.json()) });
      } catch (err) {
        res.json({ configured: true, host, ok: false, error: `Sem resposta do servidor de video (${err.cause?.code || err.name})` });
      }
    }),
  );

  // ---------- Painel ----------
  app.get(
    "/api/stats",
    requireAdmin,
    wrap(async (_req, res) => {
      const [clients, playlists] = await Promise.all([db().clients.list(), db().playlists.list()]);
      res.json({
        clients: clients.length,
        active_clients: clients.filter(isClientValid).length,
        expired_clients: clients.filter(isListExpired).length,
        playlists: clients.reduce((n, c) => n + allSources(c).length, 0) + playlists.length,
        recent: clients
          .filter((c) => c.last_access_at)
          .sort((a, b) => b.last_access_at.localeCompare(a.last_access_at))
          .slice(0, 8)
          .map(({ id, name, username, last_access_at }) => ({ id, name, username, last_access_at })),
      });
    }),
  );

  // ---------- Clientes (login/senha) ----------
  const clientResponse = (req, c) => ({ ...serializeClient(c), links: clientLinks(req) });

  app.get(
    "/api/clients",
    requireAdmin,
    wrap(async (req, res) => {
      const clients = await db().clients.list();
      res.json(clients.sort(newestFirst).map((c) => clientResponse(req, c)));
    }),
  );

  async function readClientBody(body, existing) {
    const username = str(body.username ?? existing?.username, "usuario", { required: true, max: 64 });
    if (!/^[A-Za-z0-9._-]+$/.test(username)) throw new HttpError(400, "Usuario deve conter apenas letras, numeros, ponto, _ ou -");
    const password = str(body.password ?? existing?.password, "senha", { max: 64 }) || randomPassword();
    let playlistIds = existing?.playlist_ids || [];
    if (Array.isArray(body.playlist_ids)) {
      const ids = [...new Set(body.playlist_ids.map(String))];
      const found = await Promise.all(ids.map((id) => db().playlists.get(id)));
      playlistIds = ids.filter((_id, i) => found[i]);
    }
    let source = existing?.source ?? null;
    if (body.source !== undefined) source = body.source && body.source.kind ? readSource(body.source) : null;
    // Listas extras: completam a principal (mesmo login; titulos repetidos aparecem uma vez so).
    let extra = existing?.extra_sources || [];
    if (Array.isArray(body.extra_sources)) {
      extra = body.extra_sources.filter((p) => p && p.kind).map((p) => readSource(p));
      const seen = new Set(source ? [sourceKey(source)] : []);
      extra = extra.filter((p) => !seen.has(sourceKey(p)) && seen.add(sourceKey(p)));
      if (extra.length > MAX_LISTS - 1) throw new HttpError(400, `No maximo ${MAX_LISTS} listas por cliente`);
    }
    // Sem lista principal, a primeira extra passa a ser a principal.
    if (!source && extra.length) [source, ...extra] = extra;
    return {
      source,
      extra_sources: extra,
      name: str(body.name ?? existing?.name, "nome", { max: 120 }),
      username,
      password,
      active: !!(body.active ?? existing?.active ?? true),
      notes: str(body.notes ?? existing?.notes, "observacoes"),
      playlist_ids: playlistIds,
    };
  }

  app.post(
    "/api/clients",
    requireAdmin,
    wrap(async (req, res) => {
      const data = await readClientBody(req.body || {});
      const c = await unique(() =>
        db().clients.create({ ...data, expires_at: null, list_status: null, last_access_at: null, parental_pin_hash: "", locked_groups: [] }),
      );
      await refreshListStatus(c, { force: true });
      res.status(201).json(clientResponse(req, c));
    }),
  );

  // Troca de servidor do fornecedor: os clientes marcados passam para o servidor novo, mantendo usuario e senha.
  app.post(
    "/api/servers/replace",
    requireAdmin,
    wrap(async (req, res) => {
      let to;
      try {
        to = new URL(String(req.body?.link || "").trim());
      } catch {
        to = null;
      }
      if (!to || !/^https?:$/.test(to.protocol)) throw new HttpError(400, "Cole um link do servidor novo (http://servidor/get.php?username=...&password=...)");
      to = to.origin.toLowerCase();
      const ids = new Set((Array.isArray(req.body?.client_ids) ? req.body.client_ids : []).map(String));
      if (!ids.size) throw new HttpError(400, "Marque pelo menos um cliente");
      let clients = 0;
      for (const c of await db().clients.list()) {
        if (!ids.has(String(c.id))) continue;
        // Muda o servidor da lista principal (e das extras do mesmo servidor); extras de outro fornecedor ficam.
        const from = allSources(c).map(sourceServer).find(Boolean);
        if (!from || from === to) continue;
        const source = moveSource(c.source, from, to);
        const extra = (c.extra_sources || []).map((p) => moveSource(p, from, to));
        await db().clients.update(c.id, { source, extra_sources: extra });
        forgetClient(c.id);
        listChecks.delete(c.id);
        clients++;
      }
      console.log(`[rtec] Servidor trocado para ${to} em ${clients} cliente(s)`);
      res.json({ to, clients });
    }),
  );

  // Cliente rapido: cola o link do fornecedor e o cliente nasce com o mesmo usuario, senha e validade da lista.
  app.post(
    "/api/clients/quick",
    requireAdmin,
    wrap(async (req, res) => {
      const link = String(req.body?.link || "").trim();
      const creds = xtream.parseXtreamLink(link);
      if (!creds) throw new HttpError(400, "Cole um link no formato http://servidor/get.php?username=...&password=...");
      let account = null;
      try {
        account = await xtream.accountInfo(creds);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      const username = creds.username.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64) || `cliente${crypto.randomInt(1000, 9999)}`;
      const source = readSource({ kind: "xtream", xtream_server: creds.server, xtream_username: creds.username, xtream_password: creds.password, playback: DEFAULT_PLAYBACK });
      const c = await unique(
        () =>
          db().clients.create({
            name: String(req.body?.name || "").trim().slice(0, 120) || creds.username,
            username,
            password: creds.password,
            active: true,
            expires_at: account.expires_at,
            list_status: { state: "active", reason: "", checked_at: nowIso(), last_error: "", provider_status: account.status || "Active" },
            notes: account.max_connections ? `Fornecedor: ${account.max_connections} tela(s) simultanea(s)` : "",
            source,
            playlist_ids: [],
            last_access_at: null,
            parental_pin_hash: "",
            locked_groups: [],
          }),
        `Ja existe um cliente com o usuario "${username}"`,
      );
      res.status(201).json(clientResponse(req, c));
    }),
  );

  app.put(
    "/api/clients/:id",
    requireAdmin,
    wrap(async (req, res) => {
      const existing = await db().clients.get(req.params.id);
      if (!existing) throw new HttpError(404, "Cliente nao encontrado");
      const patch = await readClientBody(req.body || {}, existing);
      // O revendedor pode voltar o PIN parental para o padrao (0000) quando o cliente esquecer.
      if (req.body?.reset_pin) patch.parental_pin_hash = "";
      const c = await unique(() => db().clients.update(existing.id, patch));
      forgetClient(existing.id);
      const lists = (x) => JSON.stringify([x.source ?? null, x.extra_sources || []]);
      if (lists(existing) !== lists(c) || !c.list_status) await refreshListStatus(c, { force: true });
      res.json(clientResponse(req, c));
    }),
  );

  // Confere agora se a lista do cliente ainda da acesso no fornecedor.
  app.post(
    "/api/clients/:id/check",
    requireAdmin,
    wrap(async (req, res) => {
      const c = await db().clients.get(req.params.id);
      if (!c) throw new HttpError(404, "Cliente nao encontrado");
      await refreshListStatus(c, { force: true });
      forgetClient(c.id);
      res.json(clientResponse(req, c));
    }),
  );

  app.delete(
    "/api/clients/:id",
    requireAdmin,
    wrap(async (req, res) => {
      const profiles = (await db().profiles.get(req.params.id))?.list ?? [];
      for (const p of profiles) if (p.id !== MAIN_PROFILE) await db().sync.delete(syncDocId(req.params.id, p.id));
      for (const p of profiles) if (p.id !== MAIN_PROFILE) await db().alerts.delete(syncDocId(req.params.id, p.id));
      await db().sync.delete(req.params.id);
      await db().alerts.delete(req.params.id);
      await db().profiles.delete(req.params.id);
      await db().clients.delete(req.params.id);
      forgetClient(req.params.id);
      res.json({ ok: true });
    }),
  );

  // Testa uma lista (do formulario do cliente) antes de salvar.
  app.post(
    "/api/source/preview",
    requireAdmin,
    wrap(async (req, res) => res.json(await previewSource(readSource(req.body || {})))),
  );

  // ---------- Listas compartilhadas (legado: hoje cada cliente tem a propria lista) ----------
  function readPlaylistBody(body, existing) {
    return {
      ...readSource(body, existing),
      name: str(body.name ?? existing?.name, "nome", { required: true, max: 120 }),
      active: !!(body.active ?? existing?.active ?? true),
    };
  }

  async function playlistResponse(p, clients) {
    clients ??= await db().clients.where("playlist_ids", "array-contains", p.id);
    const count = Array.isArray(clients) ? clients.filter((c) => (c.playlist_ids || []).includes(p.id)).length : clients;
    return {
      ...p,
      playback: p.playback || DEFAULT_PLAYBACK,
      client_count: count,
      channel_count: p.kind === "manual" ? countChannels(p.content) : null,
    };
  }

  app.get(
    "/api/playlists",
    requireAdmin,
    wrap(async (_req, res) => {
      const [playlists, clients] = await Promise.all([db().playlists.list(), db().clients.list()]);
      res.json(await Promise.all(playlists.sort(byName).map((p) => playlistResponse(p, clients))));
    }),
  );

  app.post(
    "/api/playlists",
    requireAdmin,
    wrap(async (req, res) => {
      const p = await db().playlists.create(readPlaylistBody(req.body || {}));
      res.status(201).json(await playlistResponse(p, 0));
    }),
  );

  app.put(
    "/api/playlists/:id",
    requireAdmin,
    wrap(async (req, res) => {
      const existing = await db().playlists.get(req.params.id);
      if (!existing) throw new HttpError(404, "Lista nao encontrada");
      const p = await db().playlists.update(existing.id, readPlaylistBody(req.body || {}, existing));
      res.json(await playlistResponse(p));
    }),
  );

  app.delete(
    "/api/playlists/:id",
    requireAdmin,
    wrap(async (req, res) => {
      const id = req.params.id;
      const users = await db().clients.where("playlist_ids", "array-contains", id);
      await Promise.all(users.map((c) => db().clients.update(c.id, { playlist_ids: c.playlist_ids.filter((x) => x !== id) })));
      users.forEach((c) => forgetClient(c.id));
      await db().playlists.delete(id);
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/playlists/:id/preview",
    requireAdmin,
    wrap(async (req, res) => {
      const p = await db().playlists.get(req.params.id);
      if (!p) throw new HttpError(404, "Lista nao encontrada");
      res.json(await previewSource(p));
    }),
  );

  // ---------- Reprodutor do cliente ----------
  app.post(
    "/api/player/login",
    wrap(async (req, res) => {
      assertLoginAllowed(req, "player");
      const c = await findClientByLogin(req.body?.username, req.body?.password);
      if (!c) {
        loginFailed(req, "player");
        throw new HttpError(401, "Usuario ou senha invalidos");
      }
      if (!c.active) throw new HttpError(403, BLOCKED, "blocked");
      await refreshListStatus(c, { force: true });
      await touch("clients", c, "last_access_at");
      // A sessao fica valida mesmo com a lista expirada: quando o adm renovar, o app libera sozinho ao abrir.
      signClientSession(res, req, c);
      assertClientAccess(c);
      res.json(clientProfile(c));
    }),
  );

  app.post("/api/player/logout", (_req, res) => {
    res.clearCookie(CLIENT_COOKIE);
    res.json({ ok: true });
  });

  // Abertura do app: confere a lista no fornecedor antes de liberar.
  app.get(
    "/api/player/me",
    clientSession,
    wrap(async (req, res) => {
      const c = req.client;
      if (c.active) await refreshListStatus(c, { force: req.query.recheck === "1" });
      assertClientAccess(c);
      res.json(clientProfile(c));
    }),
  );

  /** Canais das listas M3U do cliente, no formato do reprodutor (as listas extras completam a principal). */
  async function m3uChannels(c, req) {
    const channels = [];
    const playlists = [];
    const errors = [];
    const sources = await clientPlaylists(c);
    for (const p of sources) {
      let text;
      try {
        text = await loadPlaylistText(p);
      } catch (err) {
        console.warn(`[rtec] Lista do cliente "${c.username}" falhou: ${err.message}`);
        errors.push(err.message);
        continue;
      }
      // Varias listas do cliente: aparecem como uma lista so (as extras completam a principal).
      if (!p.id.startsWith(`own-${c.id}`) || !playlists.some((x) => x.id.startsWith(`own-${c.id}`))) playlists.push({ id: p.id, name: p.name });
      const mode = p.playback || DEFAULT_PLAYBACK;
      const app = isApp(req) || liteDirect(req);
      const link = (url) => (viaProxy(mode, url, app) ? proxyUrl(c.id, url) : url);
      for (const e of parseEntries(text, Infinity)) {
        if (!/^https?:\/\//i.test(e.url)) continue;
        // Servidores Xtream entregam o mesmo canal em HLS (.m3u8), que toca em mais aparelhos (ex: iPhone).
        const hlsUrl = /\/live\/.+\.ts$/i.test(e.url.split("?")[0]) ? e.url.replace(/\.ts(\?|$)/i, ".m3u8$1") : "";
        // Sem proxy, o navegador vai direto na fonte: prefere HLS, que costuma funcionar melhor assim.
        const [main, alt] = !viaProxy(mode, e.url, app) && hlsUrl ? [hlsUrl, e.url] : [e.url, hlsUrl];
        channels.push({
          id: crypto.createHash("sha1").update(`${p.id}|${e.url}`).digest("hex").slice(0, 12),
          name: e.name,
          group: e.group || p.name,
          logo: logoUrl(c.id, e.logo),
          src: link(main),
          type: streamType(main, e.kind),
          alt: alt ? link(alt) : "",
          alt_type: alt ? streamType(alt, e.kind) : "",
          kind: e.kind,
          epg_id: e.tvg_id,
          playlist_id: p.id,
        });
      }
    }
    if (channels.length > MAX_M3U_ITEMS) {
      return { playlists, channels: [], sources, errors: [`A lista tem ${channels.length.toLocaleString("pt-BR")} itens, grande demais para carregar de uma vez. Cadastre no formato Xtream (servidor, usuario e senha).`] };
    }
    const own = new Set(sources.filter((p) => p.id.startsWith(`own-${c.id}`)).map((p) => p.id));
    return { playlists, channels: mergeOwnChannels(channels, own, playlists[0]?.id), sources, errors };
  }

  app.get(
    "/api/player/channels",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      await touch("clients", c, "last_access_at");
      const { playlists, channels, sources, errors } = await m3uChannels(c, req);
      res.setHeader("Cache-Control", "no-store");
      res.json({ playlists, channels, errors, no_source: sources.length === 0 });
    }),
  );

  // Jogos do dia: a agenda vem pronta do servidor (games.js), ja cruzada com os canais ao vivo da lista do cliente.
  app.get(
    "/api/player/games",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      let agenda;
      try {
        agenda = await getAgenda(getStore());
      } catch (err) {
        console.warn(`[rtec] Jogos: agenda indisponivel: ${err.message}`);
        res.setHeader("Cache-Control", "no-store");
        return res.status(503).json({ error: `Agenda de jogos indisponível agora (${err.message}). Tente de novo em alguns minutos.` });
      }
      const adult = (name) => ADULT_GROUP.test(name || "");
      let games;
      const cat = catalogFor(c);
      if (cat) {
        const [cats, list] = await Promise.all([cat.categories("live"), cat.items("live", "")]).catch(() => [[], []]);
        const names = new Map(cats.map((x) => [x.id, x.name]));
        const live = list.filter((it) => !adult(names.get(it.category_id)));
        games = matchGames(agenda.games, live, (it) => xtreamChannel(c, it, names.get(it.category_id) || "", directXtream(req), cat.sources));
      } else {
        const { channels } = await m3uChannels(c, req);
        games = matchGames(agenda.games, channels.filter((ch) => ch.kind === "live" && !adult(ch.group)));
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ updated_at: agenda.updated_at, games, leagues: leagueList() });
    }),
  );

  // Catalogo: no formato Xtream o reprodutor carrega por categoria; nas demais listas usa /channels.
  app.get(
    "/api/player/catalog",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      await touch("clients", c, "last_access_at");
      const cat = catalogFor(c);
      if (!cat) return res.json({ mode: "m3u" });
      // Muda quando a lista principal e trocada ou quando entra/sai uma lista extra (o aparelho religa o historico).
      const main = listSig(xtream.xtreamCredentials(cat.sources[0]));
      const sig = cat.merged ? hashId(main, ...cat.sources.slice(1).map((p) => p.key)) : main;
      try {
        // Radios: precisam da lista inteira de canais; se o fornecedor demorar, o catalogo abre sem elas.
        const radio = Promise.race([cat.categories("radio"), new Promise((ok) => setTimeout(() => ok([]), RADIO_WAIT_MS))]).catch(() => []);
        const [live, movie, series] = await Promise.all(["live", "movie", "series"].map((s) => cat.categories(s)));
        res.json({ mode: "xtream", sections: { live, radio: await radio, movie, series }, sig });
      } catch (err) {
        console.warn(`[rtec] Xtream do cliente "${c.username}" falhou: ${err.message}`);
        res.json({ mode: "xtream", sections: { live: [], radio: [], movie: [], series: [] }, errors: [err.message], sig });
      }
    }),
  );

  app.get(
    "/api/player/xtream/items",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      const cat = requireXtream(c);
      const section = String(req.query.section || "");
      if (!["live", "radio", "movie", "series"].includes(section)) throw new HttpError(400, "Secao invalida");
      const channels = section === "live" || section === "radio";
      const category = String(req.query.category || "");
      // Filmes e series sem categoria ("Todos"): o catalogo inteiro e grande demais para uma resposta,
      // entao vai em paginas (limit/offset), com busca (q) e sem as categorias bloqueadas (skip).
      const limit = Math.min(500, Math.max(0, Number(req.query.limit) || 0));
      if (!category && !channels && !limit) throw new HttpError(400, "Escolha uma categoria");
      const [cats, raw] = await Promise.all([cat.categories(section), cat.items(section, category)]);
      const names = new Map(cats.map((x) => [x.id, x.name]));
      const toChannel = (it) => xtreamChannel(c, it, names.get(it.category_id) || names.get(category) || "", directXtream(req), cat.sources);
      res.setHeader("Cache-Control", "no-store");
      let list = channels ? raw : raw.map((it) => ({ ...it, genres: genreList(it, names.get(it.category_id)) }));
      const filters = channels ? null : readFilters(req.query);
      if (filters) list = list.filter((it) => passesFilters(filters, it));
      const sorted = sortItems(list, String(req.query.sort || ""));
      if (!limit) return res.json(sorted.map(toChannel));
      const skip = new Set(String(req.query.skip || "").split(",").filter(Boolean));
      const q = fold(String(req.query.q || "").trim());
      const found = sorted.filter((it) => !skip.has(it.category_id) && (!q || fold(it.name).includes(q)));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      res.json({ total: found.length, items: found.slice(offset, offset + limit).map(toChannel) });
    }),
  );

  // Opcoes do popup de filtros: generos (com quantidade) e anos existentes na secao/categoria.
  app.get(
    "/api/player/xtream/facets",
    requireClient,
    wrap(async (req, res) => {
      const cat = requireXtream(req.client);
      const section = String(req.query.section || "");
      if (!["movie", "series"].includes(section)) throw new HttpError(400, "Secao invalida");
      const category = String(req.query.category || "");
      const [cats, list] = await Promise.all([cat.categories(section), cat.items(section, category)]);
      const names = new Map(cats.map((x) => [x.id, x.name]));
      const skip = new Set(String(req.query.skip || "").split(",").filter(Boolean));
      const genres = new Map();
      let min = 0;
      let max = 0;
      let rated = 0;
      for (const it of list) {
        if (skip.has(it.category_id)) continue;
        for (const g of genreList(it, names.get(it.category_id))) {
          const k = fold(g);
          const cur = genres.get(k) || { name: g, count: 0 };
          cur.count++;
          genres.set(k, cur);
        }
        if (it.year) {
          min = min ? Math.min(min, it.year) : it.year;
          max = Math.max(max, it.year);
        }
        if (it.rating) rated++;
      }
      res.setHeader("Cache-Control", "private, max-age=600");
      res.json({
        genres: [...genres.values()].sort((a, b) => b.count - a.count || collator.compare(a.name, b.name)).slice(0, 60),
        years: { min, max },
        rated,
      });
    }),
  );

  app.get(
    "/api/player/xtream/series/:id",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      const cat = requireXtream(c);
      const episodes = await cat.episodes(req.params.id);
      res.setHeader("Cache-Control", "no-store");
      // parent_series: permite achar o proximo episodio mesmo abrindo pelo historico.
      res.json(episodes.map((ep) => ({ ...xtreamChannel(c, ep, String(req.query.name || ""), directXtream(req), cat.sources), parent_series: req.params.id })));
    }),
  );

  // Quantas temporadas cada serie tem (o "T2" no card). A lista do fornecedor nao traz isso: conta pelos episodios
  // (get_series_info), algumas series por vez, e guarda aqui para nao perguntar de novo ao fornecedor.
  const seasonsCache = new Map();
  const SEASONS_TTL = 12 * 3600 * 1000;
  app.get(
    "/api/player/xtream/seasons",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      const cat = requireXtream(c);
      const ids = [...new Set(String(req.query.ids || "").split(",").map((s) => s.replace(/[^\w~-]/g, "").slice(0, 60)).filter(Boolean))].slice(0, 30);
      const out = {};
      const queue = [...ids];
      const worker = async () => {
        for (let id; (id = queue.shift()); ) {
          const k = `${c.id}|${id}`;
          const hit = seasonsCache.get(k);
          if (hit && Date.now() - hit.at < SEASONS_TTL) {
            out[id] = hit.n;
            continue;
          }
          const eps = await cat.episodes(id).catch(() => null);
          const n = eps ? new Set(eps.map((e) => e.season)).size : 0;
          if (eps) {
            if (seasonsCache.size > 20000) seasonsCache.clear();
            seasonsCache.set(k, { at: Date.now(), n });
          }
          out[id] = n;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      res.setHeader("Cache-Control", "no-store");
      res.json(out);
    }),
  );

  // "Pular intro" e "Proximo EP" nos creditos (marks.js). O aparelho so recebe os tempos; a analise do audio
  // roda no servidor de video e fica guardada por episodio. pending: ainda analisando (o reprodutor pergunta de novo).
  async function seriesTmdbId(cat, seriesId, name) {
    const r = cat.ref(seriesId);
    const info = await r.prov.info("series", r.id).catch(() => ({}));
    if (/^\d+$/.test(info.tmdb_id || "")) return info.tmdb_id;
    return (await lookupOnline("series", name || info.name, info.year))?.tmdb_id || "";
  }

  async function audioMarks(c, list) {
    const base = proxyBase();
    if (!base) return { status: "off" };
    const u = list.map((e) => sealUrl(proxySecret(), e.url)).join("~");
    const exp = Math.ceil((Date.now() / 1000 + 3600) / 3600) * 3600;
    const q = new URLSearchParams({ u, c: c.id, e: String(exp), s: signUrl(c.id, exp, u) });
    try {
      const r = await fetch(`${base}/api/player/marks?${q}`, { signal: AbortSignal.timeout(6000) });
      // Servidor de video ainda sem esta funcao (precisa atualizar o server.mjs): segue so com a base publica.
      if (r.status === 404) return { status: "off" };
      return await r.json();
    } catch {
      return { status: "busy" };
    }
  }

  app.get(
    "/api/player/marks",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      res.setHeader("Cache-Control", "no-store");
      const cat = catalogFor(c);
      const seriesId = String(req.query.series || "").replace(/[^\w~-]/g, "").slice(0, 60);
      const season = Number(req.query.season) || 0;
      const episode = Number(req.query.episode) || 0;
      if (!cat || !seriesId || !episode) return res.json({ marks: null });
      const episodes = (await cat.episodes(seriesId).catch(() => [])).filter((e) => e.url);
      const i = episodes.findIndex((e) => e.season === season && e.episode === episode);
      if (i < 0) return res.json({ marks: null });
      const ep = episodes[i];
      const key = markKey(ep.url);
      const saved = key ? await db().marks.get(key) : null;
      if (saved?.done) return res.json({ marks: cleanMarks(saved) });

      const dur = Number(req.query.dur) || 0;
      const publicMarks = () => seriesTmdbId(cat, seriesId, String(req.query.name || "")).then((id) => theIntroDb(id, season, episode, dur)).catch(() => null);
      const failedRecently = saved?.failed_at && Date.now() - saved.failed_at < RETRY_FAILED_MS;
      const nbs = neighbors(episodes, i);
      const audio = failedRecently || !nbs.length ? { status: "off" } : await audioMarks(c, [ep, ...nbs]);

      if (audio.status === "done" && Array.isArray(audio.eps)) {
        const list = [ep, ...nbs];
        let mine = cleanMarks(audio.eps[0]);
        if (!mine) mine = await publicMarks();
        await db().marks.set(key, { ...(mine || { intro: null, credits: null, post: false }), done: true, src: cleanMarks(audio.eps[0]) ? "audio" : mine ? "tidb" : "none", at: nowIso() });
        // O vizinho tambem saiu da comparacao: ja fica pronto (so se achou algo; senao tenta com outro vizinho depois).
        for (let k = 1; k < list.length; k++) {
          const m = cleanMarks(audio.eps[k]);
          const nk = markKey(list[k].url);
          if (m && nk && nk !== key) await db().marks.set(nk, { ...m, done: true, src: "audio", at: nowIso() });
        }
        return res.json({ marks: mine });
      }
      if (audio.status === "error") await db().marks.set(key, { done: false, failed_at: Date.now() });
      const pending = audio.status === "pending" || audio.status === "busy";
      const pub = await publicMarks();
      // Sem servidor de video (ou falhou): a base publica e a resposta final para este episodio.
      if (!pending && pub && key) await db().marks.set(key, { ...pub, done: true, src: "tidb", at: nowIso() });
      res.json({ marks: pub, pending });
    }),
  );

  // Ficha do titulo (filme ou serie): dados do fornecedor completados pela internet quando faltam.
  async function fullTitleInfo(c, kind, id, name, year) {
    const cat = id ? catalogFor(c) : null;
    let info = { name, plot: "", genres: [], cast: [], director: [], year: year || 0, rating: 0, minutes: 0, poster: "", backdrop: "", trailer: "" };
    if (cat) {
      const r = cat.ref(id);
      info = { ...info, ...(await r.prov.info(kind, r.id).catch(() => ({}))) };
    }
    if (!info.name) info.name = name;
    if (!info.year) info.year = year || 0;
    // Com o TMDB tambem busca o que falta para a protecao de tela (imagem de fundo e classificacao).
    const tmdbHelps = !!process.env.TMDB_API_KEY && (!info.backdrop || !info.age);
    if ((info.plot || "").length < 40 || !info.cast?.length || !info.genres?.length || tmdbHelps) {
      info = mergeInfo(info, await lookupOnline(kind, name || info.name, info.year, info.tmdb_id));
    }
    delete info.tmdb_id;
    return info;
  }
  const titleQuery = (req) => ({
    kind: req.query.kind === "series" ? "series" : "movie",
    id: String(req.query.id || "").replace(/[^\w~-]/g, "").slice(0, 60),
    name: String(req.query.name || "").slice(0, 200),
    year: Number(req.query.year) || 0,
  });

  app.get(
    "/api/player/info",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      const { kind, id, name, year } = titleQuery(req);
      const info = await fullTitleInfo(c, kind, id, name, year);
      info.poster = logoUrl(c.id, info.poster);
      info.backdrop = logoUrl(c.id, info.backdrop);
      res.setHeader("Cache-Control", "private, max-age=21600");
      res.json(info);
    }),
  );

  // Titulos semelhantes ao aberto, so do catalogo do fornecedor do cliente (recommend.js faz a conta).
  app.get(
    "/api/player/recommend",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      const { kind, id, name, year } = titleQuery(req);
      const cat = catalogFor(c);
      if (!cat || !id) return res.json([]);
      const skip = new Set(String(req.query.skip || "").split(",").filter(Boolean));
      const [cats, list, info] = await Promise.all([cat.categories(kind), cat.items(kind, ""), fullTitleInfo(c, kind, id, name, year)]);
      const catName = new Map(cats.map((x) => [x.id, x.name]));
      const idOf = (it) => cat.qid(it);
      const self = list.find((it) => idOf(it) === id);
      const target = { ...info, id, name: info.name || name, category: self ? catName.get(self.category_id) || "" : "" };
      // So o genero do proprio titulo; o da categoria entra a parte (pesa menos) em recommend.js.
      const toCand = (it) => ({ ...it, id: idOf(it), category: catName.get(it.category_id) || "", genres: genreList(it, "") });
      const pool = list.filter((it) => !skip.has(it.category_id) && idOf(it) !== id).map(toCand);

      // 1a rodada: so com o que a lista ja traz (nome, categoria, ano, nota e, as vezes, genero/elenco).
      let ranked = rankSimilar(target, pool, { limit: 36, minScore: 0 });
      // 2a rodada: busca a ficha dos melhores que vieram sem genero, com prazo para nao travar a tela.
      const missing = ranked.filter((r) => !r.genres?.length).slice(0, 30);
      if (missing.length) {
        const deadline = Date.now() + 6000;
        const extra = new Map();
        let next = 0;
        const worker = async () => {
          while (next < missing.length && Date.now() < deadline) {
            const r = missing[next++];
            const left = deadline - Date.now();
            const ref = cat.ref(r.id);
            const got = await Promise.race([ref.prov.info(kind, ref.id).catch(() => null), new Promise((ok) => setTimeout(ok, left, null))]);
            if (got) extra.set(r.id, got);
          }
        };
        await Promise.all(Array.from({ length: 8 }, worker));
        ranked = ranked.map((r) => {
          const e = extra.get(r.id);
          if (!e) return r;
          const pick = (k) => (e[k]?.length ? e[k] : r[k]);
          return { ...r, genres: pick("genres"), cast: pick("cast"), director: pick("director"), year: r.year || e.year, rating: r.rating || e.rating };
        });
      }
      const best = rankSimilar(target, ranked, { limit: 18, minScore: 2 });
      res.setHeader("Cache-Control", "private, max-age=1800");
      res.json(best.map((r) => ({ ...xtreamChannel(c, r, r.category, directXtream(req), cat.sources), reasons: r.reasons.slice(0, 2).map((t) => (kind === "series" ? t.replace(/^Direção de/, "Criação de") : t)) })));
    }),
  );

  // Guia de programacao: agora / a seguir para os canais pedidos (ids tvg-id separados por virgula).
  app.get(
    "/api/player/epg",
    requireClient,
    wrap(async (req, res) => {
      const all = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 300);
      // Canais Xtream ("xt:<id>"): programacao curta direto da API do fornecedor (limitado por pedido).
      const xtIds = all.filter((id) => id.startsWith("xt:")).slice(0, 25);
      const ids = all.filter((id) => !id.startsWith("xt:"));
      const out = {};
      const cat = xtIds.length ? catalogFor(req.client) : null;
      if (cat) {
        await Promise.all(
          xtIds.map(async (id) => {
            const r = cat.ref(id.slice(3));
            out[id] = await r.prov.epg(r.id).catch(() => []);
          }),
        );
      }
      if (!ids.length) return res.json(out);
      const urls = new Set();
      for (const p of await clientPlaylists(req.client)) {
        if (p.epg_url) urls.add(p.epg_url);
        try {
          headerEpgUrls(await loadPlaylistText(p)).forEach((u) => urls.add(u));
        } catch {
          /* lista fora do ar: segue sem o EPG dela */
        }
      }
      res.json({ ...out, ...(urls.size ? await nowNext([...urls], ids) : {}) });
    }),
  );

  // ---------- Sincronizacao entre aparelhos (favoritos, historico e ponto onde parou) ----------
  app.get(
    "/api/player/sync",
    requireClient,
    wrap(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await loadSync(syncDocId(req.client.id, await requestProfile(req))));
    }),
  );

  // Recebe so o que mudou no aparelho e devolve o estado completo da conta.
  // Listas: vale a ultima enviada (o servidor carimba a hora). Progresso: por item, vale o mais recente.
  // merge: true (primeira sincronizacao de um aparelho antigo) junta as listas em vez de substituir.
  app.put(
    "/api/player/sync",
    requireClient,
    wrap(async (req, res) => {
      const body = req.body || {};
      const docId = syncDocId(req.client.id, await requestProfile(req));
      const s = await loadSync(docId);
      let changed = false;
      for (const [key, max] of [["favorites", MAX_FAVORITES], ["history", MAX_HISTORY]]) {
        if (!Array.isArray(body[key])) continue;
        const items = body[key].map(cleanChannel).filter(Boolean);
        const next = body.merge ? [...s[key], ...items.filter((i) => !s[key].some((o) => o.id === i.id))] : items;
        s[key] = dedupe(next).slice(0, max);
        s[`${key}_t`] = Date.now();
        changed = true;
      }
      if (body.progress && typeof body.progress === "object") {
        for (const [id, p] of Object.entries(body.progress).slice(0, MAX_PROGRESS)) {
          const entry = cleanProgress(p);
          if (!entry || id.length > 200 || (s.progress[id] && s.progress[id].t >= entry.t)) continue;
          s.progress[id] = entry;
          changed = true;
        }
        const ids = Object.keys(s.progress);
        if (ids.length > MAX_PROGRESS) {
          ids.sort((a, b) => s.progress[a].t - s.progress[b].t);
          for (const old of ids.slice(0, ids.length - MAX_PROGRESS)) delete s.progress[old];
        }
      }
      if (changed) {
        if (JSON.stringify(s).length > MAX_SYNC_BYTES) throw new HttpError(413, "Muitos favoritos salvos. Remova alguns e tente de novo.");
        await db().sync.set(docId, s);
      }
      res.json(s);
    }),
  );

  // ---------- Alertas de novos episodios (por perfil) ----------
  // Lista Xtream: o servidor confere os episodios no fornecedor no maximo a cada 3 h (nada roda no aparelho).
  // Listas M3U: o aparelho ja tem todos os episodios; aqui so fica guardado o que o cliente viu.
  app.get(
    "/api/player/alerts",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      const docId = syncDocId(c.id, await requestProfile(req));
      const [doc, s] = await Promise.all([db().alerts.get(docId).then((d) => d || {}), loadSync(docId)]);
      const targets = alertTargets(doc, s.favorites);
      const cat = catalogFor(c);
      if (cat && targets.length && Date.now() - (doc.checked_at || 0) > CHECK_EVERY_MS) {
        await checkAlerts(doc, targets, (t) => cat.episodes(t.series_id));
        await db().alerts.set(docId, doc);
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ mode: cat ? "xtream" : "m3u", checked_at: doc.checked_at || 0, items: alertList(doc, targets) });
    }),
  );

  // Liga/desliga o alerta de uma serie (on: true, false ou null para seguir o favorito).
  // Com count/top (episodios que o aparelho esta vendo), ja guarda a comparacao.
  app.put(
    "/api/player/alerts",
    requireClient,
    wrap(async (req, res) => {
      const s = cleanSeries(req.body);
      if (!s) throw new HttpError(400, "Serie invalida");
      const on = req.body.on === true || req.body.on === false ? req.body.on : null;
      const docId = syncDocId(req.client.id, await requestProfile(req));
      const doc = (await db().alerts.get(docId)) || {};
      setAlert(doc, s, on, readSnap(req.body));
      await db().alerts.set(docId, doc);
      res.json({ ok: true });
    }),
  );

  // O cliente abriu a serie: os episodios de agora passam a ser os "ja vistos".
  app.post(
    "/api/player/alerts/seen",
    requireClient,
    wrap(async (req, res) => {
      const s = cleanSeries(req.body);
      const snap = readSnap(req.body);
      if (!s || !snap) throw new HttpError(400, "Serie invalida");
      const docId = syncDocId(req.client.id, await requestProfile(req));
      const doc = (await db().alerts.get(docId)) || {};
      const e = doc.series?.[s.id];
      if (e?.base?.count === snap.count && e.base.top === snap.top && e.cur?.count === snap.count && e.cur.top === snap.top) return res.json({ ok: true });
      markSeen(doc, s, snap);
      await db().alerts.set(docId, doc);
      res.json({ ok: true });
    }),
  );

  // ---------- Perfis ----------
  app.get(
    "/api/player/profiles",
    requireClient,
    wrap(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json({ profiles: await loadProfiles(req.client), max: MAX_PROFILES });
    }),
  );

  app.post(
    "/api/player/profiles",
    requireClient,
    wrap(async (req, res) => {
      const list = await loadProfiles(req.client);
      if (list.length >= MAX_PROFILES) throw new HttpError(400, `Limite de ${MAX_PROFILES} perfis por conta`);
      const profile = { id: randomToken().slice(0, 10), ...readProfileBody(req.body || {}) };
      await db().profiles.set(req.client.id, { list: [...list, profile] });
      res.json(profile);
    }),
  );

  app.put(
    "/api/player/profiles/:pid",
    requireClient,
    wrap(async (req, res) => {
      const list = await loadProfiles(req.client);
      const i = list.findIndex((p) => p.id === req.params.pid);
      if (i < 0) throw new HttpError(404, "Perfil nao encontrado");
      const profile = { id: list[i].id, ...readProfileBody(req.body || {}, list[i]) };
      await db().profiles.set(req.client.id, { list: list.map((p, j) => (j === i ? profile : p)) });
      res.json(profile);
    }),
  );

  app.delete(
    "/api/player/profiles/:pid",
    requireClient,
    wrap(async (req, res) => {
      const list = await loadProfiles(req.client);
      if (!list.some((p) => p.id === req.params.pid)) throw new HttpError(404, "Perfil nao encontrado");
      if (list.length <= 1) throw new HttpError(400, "A conta precisa de pelo menos um perfil");
      await db().profiles.set(req.client.id, { list: list.filter((p) => p.id !== req.params.pid) });
      await db().sync.delete(syncDocId(req.client.id, req.params.pid));
      await db().alerts.delete(syncDocId(req.client.id, req.params.pid));
      res.json({ ok: true });
    }),
  );

  // ---------- Controle parental (PIN) ----------
  app.get("/api/player/settings", requireClient, (req, res) => {
    res.json({ custom_pin: !!req.client.parental_pin_hash, locked_groups: req.client.locked_groups || [] });
  });

  // "Tocar em outro aparelho": os aparelhos abertos da conta conversam por um canal de mensagens (ntfy, sem custo
  // para a Vercel nem leituras no Firestore). O canal e a chave saem do segredo do painel: so quem entra na conta
  // conhece o nome do canal, e as mensagens vao cifradas (o servico de mensagens nao ve titulos nem links).
  app.get("/api/player/cast", requireClient, (req, res) => {
    const mac = (label) => crypto.createHmac("sha256", JWT_SECRET).update(`${label}:${req.client.id}`).digest();
    res.json({
      // So https: canal em http deixaria o nome do canal aberto na rede.
      relay: (/^https:\/\//i.test(env("CAST_RELAY_URL")) ? env("CAST_RELAY_URL") : "https://ntfy.sh").replace(/\/+$/, ""),
      topic: `rtec_${mac("cast-topic").toString("hex").slice(0, 32)}`,
      key: mac("cast-key").toString("base64url"),
    });
  });

  app.post("/api/player/pin/verify", requireClient, (req, res) => {
    if (!checkPin(req, req.body?.pin)) throw new HttpError(403, "PIN incorreto");
    res.json({ ok: true });
  });

  app.post(
    "/api/player/pin",
    requireClient,
    wrap(async (req, res) => {
      const { current, pin } = req.body || {};
      if (!checkPin(req, current)) throw new HttpError(403, "PIN atual incorreto");
      if (!/^\d{4,8}$/.test(String(pin || ""))) throw new HttpError(400, "O PIN deve ter de 4 a 8 numeros");
      await db().clients.update(req.client.id, { parental_pin_hash: bcrypt.hashSync(String(pin), 10) });
      forgetClient(req.client.id);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/player/locked-groups",
    requireClient,
    wrap(async (req, res) => {
      const { pin, groups } = req.body || {};
      if (!checkPin(req, pin)) throw new HttpError(403, "PIN incorreto");
      if (!Array.isArray(groups)) throw new HttpError(400, "Lista de grupos invalida");
      const clean = [...new Set(groups.map((g) => String(g).slice(0, 200)))].slice(0, 500);
      await db().clients.update(req.client.id, { locked_groups: clean });
      forgetClient(req.client.id);
      res.json({ locked_groups: clean });
    }),
  );

  // Renova links do proxy guardados no aparelho (historico, favoritos, "continuar assistindo"), que
  // expiram em 12 h. So renova links que este servidor assinou para este mesmo cliente.
  app.post(
    "/api/player/resign",
    requireClient,
    wrap(async (req, res) => {
      const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 50) : [];
      const out = urls.map((raw) => {
        const link = String(raw || "");
        let parsed;
        try {
          parsed = new URL(link, "http://local");
        } catch {
          return link;
        }
        if (!parsed.pathname.endsWith("/api/player/proxy")) return link; // link direto: nao expira
        const { u, c, e, s } = Object.fromEntries(parsed.searchParams);
        const url = c === req.client.id ? proxyTarget(u, c, e, s, { allowExpired: true }) : "";
        return url ? proxyUrl(req.client.id, url) : "";
      });
      res.json({ urls: out });
    }),
  );

  // Religa historico e favoritos guardados a lista Xtream atual (link trocado, outro servidor ou outro
  // usuario): os ids e links antigos nao valem mais, entao acha cada titulo pelo nome (e temporada/episodio).
  // Devolve, na mesma ordem, o item atualizado ou null quando o titulo nao existe na lista nova.
  app.post(
    "/api/player/relink",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      const cat = requireXtream(c);
      const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, MAX_FAVORITES + MAX_HISTORY).map(cleanChannel);
      const direct = directXtream(req);
      const lists = {};
      const section = async (kind) => {
        if (!lists[kind]) {
          lists[kind] = Promise.all([cat.categories(kind), cat.items(kind, "")]).then(([cats, list]) => {
            const names = new Map(cats.map((x) => [x.id, x.name]));
            const byName = new Map();
            const byId = new Map();
            for (const it of list) {
              const n = normTitle(it.name);
              if (n && !byName.has(n)) byName.set(n, it);
              byId.set(cat.qid(it), it);
            }
            return { byName, byId, group: (it) => names.get(it.category_id) || "" };
          });
        }
        return lists[kind];
      };
      const episodes = new Map(); // series_id -> episodios (busca cada serie uma vez)
      const MAX_SERIES = 20;
      const findSeries = async (id, name) => {
        const s = await section("series");
        const n = normTitle(name);
        const same = id && s.byId.get(id);
        return same && normTitle(same.name) === n ? same : s.byName.get(n) || null;
      };
      const relink = async (it) => {
        if (!it) return null;
        if (it.kind === "series" && (it.series_id || it.id.startsWith("serie:"))) {
          const found = await findSeries(it.series_id, it.name);
          return found ? xtreamChannel(c, found, (await section("series")).group(found), direct, cat.sources) : null;
        }
        if (it.kind === "series") {
          const ep = episodeOf(it);
          if (!ep) return null;
          const found = await findSeries(it.parent_series, ep.series);
          if (!found) return null;
          const sid = cat.qid(found);
          if (!episodes.has(sid)) {
            if (episodes.size >= MAX_SERIES) return null;
            episodes.set(sid, cat.episodes(sid).catch(() => []));
          }
          const hit = (await episodes.get(sid)).find((e) => e.season === ep.season && e.episode === ep.episode);
          return hit ? { ...xtreamChannel(c, hit, found.name, direct, cat.sources), parent_series: sid } : null;
        }
        if (it.kind !== "live" && it.kind !== "radio" && it.kind !== "movie") return null;
        const s = await section(it.kind);
        const xtId = it.epg_id?.startsWith("xt:") ? it.epg_id.slice(3) : it.xt_id;
        const same = xtId && s.byId.get(xtId);
        const found = same && normTitle(same.name) === normTitle(it.name) ? same : s.byName.get(normTitle(it.name));
        return found ? xtreamChannel(c, found, s.group(found), direct, cat.sources) : null;
      };
      const out = await Promise.all(items.map((it) => relink(it).catch(() => null)));
      res.setHeader("Cache-Control", "no-store");
      res.json({ items: out });
    }),
  );

  // Repassa streams e logos pelo servidor (listas no modo "proxy"): evita bloqueio de CORS e de conteudo
  // http em site https. So aceita URLs assinadas pelo proprio servidor para o cliente logado.
  app.get(
    "/api/player/proxy",
    wrap(async (req, res) => {
      const clientId = String(req.query.c || "");
      const url = proxyTarget(String(req.query.u || ""), clientId, req.query.e, req.query.s);
      if (!url) throw new HttpError(403, "Link invalido ou expirado");
      const client = await getClient(clientId);
      if (!isClientValid(client)) throw new HttpError(403, "Acesso expirado ou bloqueado");
      req.client = client;
      res.setHeader("Access-Control-Allow-Origin", "*");
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      const headers = { "User-Agent": "VLC/3.0.20 LibVLC/3.0.20" };
      // Filmes/series: pede ao fornecedor so um pedaco por vez (o navegador busca o proximo sozinho),
      // para cada resposta terminar rapido e caber no limite de tempo da funcao da Vercel.
      const isFile = /\.(mp4|mkv|avi|mov|m4v|webm)$/i.test(new URL(url).pathname);
      if (isFile && PROXY_CHUNK_BYTES) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "bytes=0-");
        const start = m ? Number(m[1]) : 0;
        const end = m && m[2] ? Math.min(Number(m[2]), start + PROXY_CHUNK_BYTES - 1) : start + PROXY_CHUNK_BYTES - 1;
        headers.Range = `bytes=${start}-${end}`;
      } else if (req.headers.range) {
        headers.Range = req.headers.range;
      }
      let upstream;
      try {
        upstream = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
      } catch (err) {
        if (!controller.signal.aborted) console.warn(`[rtec] Proxy: falha ao conectar em ${new URL(url).host}: ${err.cause?.code || err.message}`);
        if (!res.headersSent && !controller.signal.aborted) res.status(502).json({ error: "Falha ao conectar na fonte" });
        return;
      }
      if (!upstream.ok) console.warn(`[rtec] Proxy: fornecedor respondeu HTTP ${upstream.status} para ${new URL(url).host} (cliente ${req.client.username})`);
      const type = upstream.headers.get("content-type") || "";
      if (/mpegurl/i.test(type) || /\.m3u8$/i.test(new URL(upstream.url).pathname)) {
        const text = await upstream.text();
        res.status(upstream.status);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "no-store");
        res.send(rewriteHls(text, upstream.url, req.client.id, ""));
        return;
      }
      res.status(upstream.status);
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (!upstream.body) return res.end();
      // Ao vivo continuo: encerra antes do limite da funcao; o reprodutor reconecta sozinho.
      const timer = PROXY_MAX_SECONDS ? setTimeout(() => controller.abort(), PROXY_MAX_SECONDS * 1000) : null;
      res.on("close", () => timer && clearTimeout(timer));
      Readable.fromWeb(upstream.body)
        .on("error", () => res.end())
        .pipe(res);
    }),
  );

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Rota nao encontrada")));

  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? (/Firebase/.test(err.message) ? err.message : "Erro interno") : err.message, ...(err.code && { code: err.code }) });
  });

  return app;
}
