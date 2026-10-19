import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { DuplicateError, getStore } from "./store/index.js";
import { buildMergedM3u, countChannels, headerEpgUrls, loadPlaylistText, parseEntries, sourceUrl } from "./m3u.js";
import { nowNext } from "./epg.js";
import * as xtream from "./xtream.js";

const COOKIE = "rtec_session";
const CLIENT_COOKIE = "rtec_player";
const DEFAULT_PIN = "0000";
const MAX_MANUAL_BYTES = 900 * 1024; // um documento do Firestore aceita ate 1 MB

// "direct": o navegador busca o video na fonte (nao gasta banda do servidor).
// "proxy": o video passa pelo servidor (resolve CORS e links http, mas consome banda).
// "auto": links https vao direto; links http passam pelo servidor (o navegador bloqueia http em site https).
const DEFAULT_PLAYBACK = process.env.DEFAULT_PLAYBACK || "auto";
const PLAYBACK_MODES = ["auto", "direct", "proxy"];

function viaProxy(mode, url) {
  // Link http nunca toca direto: o navegador bloqueia http dentro de um site https.
  if (!/^https:/i.test(url)) return true;
  return mode === "proxy";
}

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
  constructor(status, message) {
    super(message);
    this.status = status;
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
 * - sem nenhum admin: cria com ADMIN_USER / ADMIN_PASSWORD (padrao admin / admin123);
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
  const password = env("ADMIN_PASSWORD") || "admin123";
  await unique(() => db.admins.create({ username, password_hash: bcrypt.hashSync(password, 10) })).catch(() => {});
  console.log(`[rtec] Admin inicial criado: ${username} / ${env("ADMIN_PASSWORD") ? "(senha de ADMIN_PASSWORD)" : password}`);
}

let ready;
function init() {
  ready ??= (async () => {
    const db = getStore();
    if (!JWT_SECRET) JWT_SECRET = await db.getOrCreateSecret(() => crypto.randomBytes(32).toString("hex"));
    await ensureAdminAccount(db);
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

function isClientValid(c) {
  if (!c || !c.active) return false;
  return !c.expires_at || new Date(c.expires_at) > new Date();
}

/** Atualiza "ultimo acesso" no maximo a cada 5 minutos, para nao gastar gravacoes. */
async function touch(collection, doc, field) {
  if (doc[field] && Date.now() - new Date(doc[field]).getTime() < 5 * 60_000) return;
  doc[field] = nowIso();
  await getStore()[collection].update(doc.id, { [field]: doc[field] });
}

// Muda quando a senha do cliente muda, derrubando sessoes antigas do reprodutor.
const passwordFingerprint = (c) => crypto.createHash("sha256").update(c.password).digest("hex").slice(0, 16);

function signUrl(clientId, url) {
  return crypto.createHmac("sha256", JWT_SECRET).update(`${clientId}|${url}`).digest("base64url").slice(0, 32);
}

function verifySignature(clientId, url, sig) {
  const expected = Buffer.from(signUrl(clientId, url));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const proxyUrl = (clientId, url) => `/api/player/proxy?u=${encodeURIComponent(url)}&s=${signUrl(clientId, url)}`;

function streamType(url) {
  const pathname = url.split(/[?#]/)[0].toLowerCase();
  if (pathname.endsWith(".m3u8")) return "hls";
  if (/\.(mp4|mkv|webm|mov|m4v|mp3|aac)$/.test(pathname)) return "file";
  return "mpegts";
}

/** Reescreve uma playlist HLS para que segmentos, chaves e sub-playlists passem pelo proxy. */
function rewriteHls(text, baseUrl, clientId) {
  const abs = (u) => new URL(u, baseUrl).toString();
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${proxyUrl(clientId, abs(u))}"`);
      return proxyUrl(clientId, abs(t));
    })
    .join("\n");
}

function clientProfile(c) {
  return { name: c.name, username: c.username, expires_at: c.expires_at };
}

function signClientSession(res, req, c) {
  const token = jwt.sign({ cid: c.id, pw: passwordFingerprint(c) }, JWT_SECRET, { expiresIn: "30d" });
  res.cookie(CLIENT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 30 * 24 * 3600 * 1000 });
}

function requireAdmin(req, _res, next) {
  try {
    req.admin = jwt.verify(req.cookies[COOKIE], JWT_SECRET);
    next();
  } catch {
    next(new HttpError(401, "Nao autenticado"));
  }
}

const requireClient = wrap(async (req, _res, next) => {
  let payload;
  try {
    payload = jwt.verify(req.cookies[CLIENT_COOKIE], JWT_SECRET);
  } catch {
    throw new HttpError(401, "Nao autenticado");
  }
  const c = await getClient(payload.cid);
  if (!c || payload.pw !== passwordFingerprint(c)) throw new HttpError(401, "Sessao expirada, entre novamente");
  if (!isClientValid(c)) throw new HttpError(403, "Acesso expirado ou bloqueado. Fale com seu revendedor.");
  req.client = c;
  next();
});

async function clientPlaylists(c) {
  const db = getStore();
  const own = c.source?.kind ? [{ ...c.source, id: `own-${c.id}`, name: c.name || c.username, active: true }] : [];
  const shared = await Promise.all((c.playlist_ids || []).map((id) => db.playlists.get(id)));
  return [...own, ...shared.filter((p) => p && p.active).sort(byName)];
}

function serializeClient(c) {
  const { parental_pin_hash, locked_groups: _locked, ...rest } = c;
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

function clientLinks(req, c) {
  const base = baseUrl(req);
  const q = new URLSearchParams({ username: c.username, password: c.password });
  return {
    m3u: `${base}/get.php?${q}&type=m3u_plus&output=ts`,
    m3u_token: `${base}/m3u/${c.token}.m3u`,
    server: base,
  };
}

async function sendM3u(res, client) {
  await touch("clients", client, "last_access_at");
  const text = await buildMergedM3u(await clientPlaylists(client));
  res.setHeader("Content-Type", "audio/x-mpegurl; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${client.username}.m3u"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(text);
}

async function findClientByLogin(username, password) {
  const c = await getStore().clients.findOne("username", String(username || ""));
  if (!c || c.password !== String(password || "")) return null;
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
    const kinds = { live: 0, movie: 0, series: 0 };
    all.forEach((e) => kinds[e.kind]++);
    const groups = [...new Set(all.map((e) => e.group).filter(Boolean))];
    return { ok: true, source: sourceUrl(p), channel_count: countChannels(text), kinds, groups, entries: all.slice(0, 100) };
  } catch (err) {
    return { ok: false, source: sourceUrl(p), error: err.message };
  }
}

const MAX_M3U_ITEMS = 20000;

/** Logos https vao direto; http passam pelo servidor (imagens sao pequenas). */
const logoUrl = (clientId, url) => (!/^https?:\/\//i.test(url || "") ? "" : /^https:/i.test(url) ? url : proxyUrl(clientId, url));

const hashId = (...parts) => crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);

/** Converte um item da API Xtream no formato de canal usado pelo reprodutor. */
function xtreamChannel(c, item, group) {
  const mode = c.source?.playback || DEFAULT_PLAYBACK;
  const link = (url) => (viaProxy(mode, url) ? proxyUrl(c.id, url) : url);
  if (item.kind === "series" && item.series_id) {
    return { id: `s${item.series_id}`, series_id: item.series_id, name: item.name, group, logo: logoUrl(c.id, item.logo), src: "", type: "file", alt: "", alt_type: "", kind: "series", epg_id: "", playlist_id: "own" };
  }
  return {
    id: hashId(c.id, item.kind, item.stream_id),
    name: item.name,
    group,
    logo: logoUrl(c.id, item.logo),
    src: link(item.url),
    type: streamType(item.url),
    alt: item.alt_url ? link(item.alt_url) : "",
    alt_type: item.alt_url ? streamType(item.alt_url) : "",
    kind: item.kind,
    epg_id: item.kind === "live" ? `xt:${item.stream_id}` : "",
    playlist_id: "own",
    ...(item.season ? { season: item.season, episode: item.episode } : {}),
  };
}

function requireXtream(c) {
  const creds = xtream.xtreamCredentials(c.source);
  if (!creds) throw new HttpError(400, "A lista deste cliente nao e Xtream");
  return creds;
}

const checkPin = (c, pin) => (c.parental_pin_hash ? bcrypt.compareSync(String(pin || ""), c.parental_pin_hash) : String(pin || "") === DEFAULT_PIN);

export function createApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "4mb" }));
  app.use(cookieParser());
  app.use(wrap(async (_req, _res, next) => (await init(), next())));

  const db = () => getStore();

  // ---------- Autenticacao do administrador ----------
  app.post(
    "/api/auth/login",
    wrap(async (req, res) => {
      const username = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "");
      let admin = await db().admins.findOne("username", username);
      if (!admin && (await db().admins.list()).length === 0) {
        // Admin apagado no Firestore com o servidor ja rodando: recria na hora.
        await ensureAdminAccount(db());
        admin = await db().admins.findOne("username", username);
      }
      if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
        console.warn(`[rtec] Login de admin recusado para "${username}": ${admin ? "senha incorreta" : "usuario nao existe"}`);
        throw new HttpError(401, "Usuario ou senha invalidos");
      }
      const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: "7d" });
      res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 7 * 24 * 3600 * 1000 });
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
      if (String(next || "").length < 6) throw new HttpError(400, "A nova senha precisa ter ao menos 6 caracteres");
      await db().admins.update(admin.id, { password_hash: bcrypt.hashSync(String(next), 10) });
      res.json({ ok: true });
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
        expired_clients: clients.filter((c) => c.expires_at && new Date(c.expires_at) <= new Date()).length,
        playlists: clients.filter((c) => c.source?.kind).length + playlists.length,
        recent: clients
          .filter((c) => c.last_access_at)
          .sort((a, b) => b.last_access_at.localeCompare(a.last_access_at))
          .slice(0, 8)
          .map(({ id, name, username, last_access_at }) => ({ id, name, username, last_access_at })),
      });
    }),
  );

  // ---------- Clientes (login/senha) ----------
  const clientResponse = (req, c) => ({ ...serializeClient(c), links: clientLinks(req, c) });

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
    const expires = body.expires_at === undefined ? existing?.expires_at ?? null : body.expires_at || null;
    if (expires && Number.isNaN(new Date(expires).getTime())) throw new HttpError(400, "Data de validade invalida");
    let playlistIds = existing?.playlist_ids || [];
    if (Array.isArray(body.playlist_ids)) {
      const ids = [...new Set(body.playlist_ids.map(String))];
      const found = await Promise.all(ids.map((id) => db().playlists.get(id)));
      playlistIds = ids.filter((_id, i) => found[i]);
    }
    let source = existing?.source ?? null;
    if (body.source !== undefined) source = body.source && body.source.kind ? readSource(body.source) : null;
    return {
      source,
      name: str(body.name ?? existing?.name, "nome", { max: 120 }),
      username,
      password,
      active: !!(body.active ?? existing?.active ?? true),
      expires_at: expires ? new Date(expires).toISOString() : null,
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
        db().clients.create({ ...data, token: randomToken(), last_access_at: null, parental_pin_hash: "", locked_groups: [] }),
      );
      res.status(201).json(clientResponse(req, c));
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
            notes: account.max_connections ? `Fornecedor: ${account.max_connections} tela(s) simultanea(s)` : "",
            source,
            playlist_ids: [],
            token: randomToken(),
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
      res.json(clientResponse(req, c));
    }),
  );

  app.post(
    "/api/clients/:id/regenerate-token",
    requireAdmin,
    wrap(async (req, res) => {
      const c = await db().clients.update(req.params.id, { token: randomToken() });
      if (!c) throw new HttpError(404, "Cliente nao encontrado");
      res.json(clientResponse(req, c));
    }),
  );

  app.delete(
    "/api/clients/:id",
    requireAdmin,
    wrap(async (req, res) => {
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
      const c = await findClientByLogin(req.body?.username, req.body?.password);
      if (!c) throw new HttpError(401, "Usuario ou senha invalidos");
      if (!isClientValid(c)) throw new HttpError(403, "Acesso expirado ou bloqueado. Fale com seu revendedor.");
      await touch("clients", c, "last_access_at");
      signClientSession(res, req, c);
      res.json(clientProfile(c));
    }),
  );

  app.post("/api/player/logout", (_req, res) => {
    res.clearCookie(CLIENT_COOKIE);
    res.json({ ok: true });
  });

  app.get("/api/player/me", requireClient, (req, res) => res.json(clientProfile(req.client)));

  app.get(
    "/api/player/channels",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      await touch("clients", c, "last_access_at");
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
        playlists.push({ id: p.id, name: p.name });
        const mode = p.playback || DEFAULT_PLAYBACK;
        const link = (url) => (viaProxy(mode, url) ? proxyUrl(c.id, url) : url);
        for (const e of parseEntries(text, Infinity)) {
          if (!/^https?:\/\//i.test(e.url)) continue;
          // Servidores Xtream entregam o mesmo canal em HLS (.m3u8), que toca em mais aparelhos (ex: iPhone).
          const hlsUrl = /\/live\/.+\.ts$/i.test(e.url.split("?")[0]) ? e.url.replace(/\.ts(\?|$)/i, ".m3u8$1") : "";
          // Sem proxy, o navegador vai direto na fonte: prefere HLS, que costuma funcionar melhor assim.
          const [main, alt] = !viaProxy(mode, e.url) && hlsUrl ? [hlsUrl, e.url] : [e.url, hlsUrl];
          channels.push({
            id: crypto.createHash("sha1").update(`${p.id}|${e.url}`).digest("hex").slice(0, 12),
            name: e.name,
            group: e.group || p.name,
            logo: logoUrl(c.id, e.logo),
            src: link(main),
            type: streamType(main),
            alt: alt ? link(alt) : "",
            alt_type: alt ? streamType(alt) : "",
            kind: e.kind,
            epg_id: e.tvg_id,
            playlist_id: p.id,
          });
        }
      }
      res.setHeader("Cache-Control", "no-store");
      if (channels.length > MAX_M3U_ITEMS) {
        return res.json({
          playlists,
          channels: [],
          errors: [`A lista tem ${channels.length.toLocaleString("pt-BR")} itens, grande demais para carregar de uma vez. Cadastre no formato Xtream (servidor, usuario e senha).`],
        });
      }
      res.json({ playlists, channels, errors, no_source: sources.length === 0 });
    }),
  );

  // Catalogo: no formato Xtream o reprodutor carrega por categoria; nas demais listas usa /channels.
  app.get(
    "/api/player/catalog",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      await touch("clients", c, "last_access_at");
      const creds = xtream.xtreamCredentials(c.source);
      if (!creds) return res.json({ mode: "m3u" });
      try {
        const [live, movie, series] = await Promise.all(["live", "movie", "series"].map((s) => xtream.categories(creds, s)));
        res.json({ mode: "xtream", sections: { live, movie, series } });
      } catch (err) {
        console.warn(`[rtec] Xtream do cliente "${c.username}" falhou: ${err.message}`);
        res.json({ mode: "xtream", sections: { live: [], movie: [], series: [] }, errors: [err.message] });
      }
    }),
  );

  app.get(
    "/api/player/xtream/items",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      const creds = requireXtream(c);
      const section = String(req.query.section || "");
      if (!["live", "movie", "series"].includes(section)) throw new HttpError(400, "Secao invalida");
      const category = String(req.query.category || "");
      if (!category && section !== "live") throw new HttpError(400, "Escolha uma categoria");
      const [cats, list] = await Promise.all([xtream.categories(creds, section), xtream.items(creds, section, category)]);
      const names = new Map(cats.map((x) => [x.id, x.name]));
      res.setHeader("Cache-Control", "no-store");
      res.json(list.map((it) => xtreamChannel(c, it, names.get(it.category_id) || names.get(category) || "")));
    }),
  );

  app.get(
    "/api/player/xtream/series/:id",
    requireClient,
    wrap(async (req, res) => {
      const c = req.client;
      const episodes = await xtream.seriesEpisodes(requireXtream(c), req.params.id);
      res.setHeader("Cache-Control", "no-store");
      res.json(episodes.map((ep) => xtreamChannel(c, ep, String(req.query.name || ""))));
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
      const creds = xtIds.length ? xtream.xtreamCredentials(req.client.source) : null;
      if (creds) {
        await Promise.all(
          xtIds.map(async (id) => {
            out[id] = await xtream.shortEpg(creds, id.slice(3)).catch(() => []);
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

  // ---------- Controle parental (PIN) ----------
  app.get("/api/player/settings", requireClient, (req, res) => {
    res.json({ custom_pin: !!req.client.parental_pin_hash, locked_groups: req.client.locked_groups || [] });
  });

  app.post("/api/player/pin/verify", requireClient, (req, res) => {
    if (!checkPin(req.client, req.body?.pin)) throw new HttpError(403, "PIN incorreto");
    res.json({ ok: true });
  });

  app.post(
    "/api/player/pin",
    requireClient,
    wrap(async (req, res) => {
      const { current, pin } = req.body || {};
      if (!checkPin(req.client, current)) throw new HttpError(403, "PIN atual incorreto");
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
      if (!checkPin(req.client, pin)) throw new HttpError(403, "PIN incorreto");
      if (!Array.isArray(groups)) throw new HttpError(400, "Lista de grupos invalida");
      const clean = [...new Set(groups.map((g) => String(g).slice(0, 200)))].slice(0, 500);
      await db().clients.update(req.client.id, { locked_groups: clean });
      forgetClient(req.client.id);
      res.json({ locked_groups: clean });
    }),
  );

  // Repassa streams e logos pelo servidor (listas no modo "proxy"): evita bloqueio de CORS e de conteudo
  // http em site https. So aceita URLs assinadas pelo proprio servidor para o cliente logado.
  app.get(
    "/api/player/proxy",
    requireClient,
    wrap(async (req, res) => {
      const url = String(req.query.u || "");
      if (!/^https?:\/\//i.test(url) || !verifySignature(req.client.id, url, String(req.query.s || ""))) {
        throw new HttpError(403, "Link invalido");
      }
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
        res.send(rewriteHls(text, upstream.url, req.client.id));
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

  // ---------- Endpoints publicos para apps IPTV ----------
  // Compativel com apps que aceitam "URL M3U" no formato Xtream (get.php).
  app.get(
    "/get.php",
    wrap(async (req, res) => {
      const c = await findClientByLogin(req.query.username, req.query.password);
      if (!isClientValid(c)) return res.status(401).type("text").send("Unauthorized");
      await sendM3u(res, c);
    }),
  );

  app.get(
    "/m3u/:token.m3u",
    wrap(async (req, res) => {
      const c = await db().clients.findOne("token", req.params.token);
      if (!isClientValid(c)) return res.status(401).type("text").send("Unauthorized");
      await sendM3u(res, c);
    }),
  );

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Rota nao encontrada")));

  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? (/Firebase/.test(err.message) ? err.message : "Erro interno") : err.message });
  });

  return app;
}
