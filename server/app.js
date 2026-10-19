import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { DuplicateError, getStore } from "./store/index.js";
import { buildMergedM3u, countChannels, headerEpgUrls, loadPlaylistText, parseEntries, sourceUrl } from "./m3u.js";
import { nowNext } from "./epg.js";

const COOKIE = "rtec_session";
const CLIENT_COOKIE = "rtec_player";
const DEFAULT_PIN = "0000";
const MAX_MANUAL_BYTES = 900 * 1024; // um documento do Firestore aceita ate 1 MB

// "direct": o navegador busca o video na fonte (nao gasta banda do servidor; ideal no plano gratis da Vercel).
// "proxy": o video passa pelo servidor (resolve CORS e links http, mas consome banda).
const DEFAULT_PLAYBACK = process.env.DEFAULT_PLAYBACK || (process.env.VERCEL ? "direct" : "proxy");

let JWT_SECRET = process.env.JWT_SECRET || "";

const randomToken = () => crypto.randomBytes(16).toString("hex");
const randomPassword = () => crypto.randomBytes(6).toString("base64url");
const normalizeMac = (mac) => String(mac || "").toUpperCase().replace(/[^0-9A-F]/g, "").replace(/(..)(?!$)/g, "$1:");
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

async function unique(fn, message = "Ja existe um registro com esse valor (usuario/Device ID)") {
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
  return { name: c.name, username: c.username, expires_at: c.expires_at, max_devices: c.max_devices };
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
  const lists = await Promise.all((c.playlist_ids || []).map((id) => db.playlists.get(id)));
  return lists.filter((p) => p && p.active).sort(byName);
}

function serializeClient(c, deviceCount = 0) {
  const { parental_pin_hash, locked_groups: _locked, ...rest } = c;
  return { ...rest, playlist_ids: c.playlist_ids || [], device_count: deviceCount, valid: isClientValid(c), custom_pin: !!parental_pin_hash };
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
      const [clients, playlists, devices] = await Promise.all([db().clients.list(), db().playlists.list(), db().devices.list()]);
      res.json({
        clients: clients.length,
        active_clients: clients.filter(isClientValid).length,
        expired_clients: clients.filter((c) => c.expires_at && new Date(c.expires_at) <= new Date()).length,
        playlists: playlists.length,
        devices: devices.length,
        recent: clients
          .filter((c) => c.last_access_at)
          .sort((a, b) => b.last_access_at.localeCompare(a.last_access_at))
          .slice(0, 8)
          .map(({ id, name, username, last_access_at }) => ({ id, name, username, last_access_at })),
      });
    }),
  );

  // ---------- Clientes (login/senha) ----------
  async function clientResponse(req, c) {
    const devices = await db().devices.where("client_id", "==", c.id);
    return { ...serializeClient(c, devices.length), links: clientLinks(req, c) };
  }

  app.get(
    "/api/clients",
    requireAdmin,
    wrap(async (req, res) => {
      const [clients, devices] = await Promise.all([db().clients.list(), db().devices.list()]);
      const counts = {};
      for (const d of devices) counts[d.client_id] = (counts[d.client_id] || 0) + 1;
      res.json(clients.sort(newestFirst).map((c) => ({ ...serializeClient(c, counts[c.id] || 0), links: clientLinks(req, c) })));
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
    return {
      name: str(body.name ?? existing?.name, "nome", { max: 120 }),
      username,
      password,
      active: !!(body.active ?? existing?.active ?? true),
      max_devices: Math.max(1, Number(body.max_devices ?? existing?.max_devices ?? 1) || 1),
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
      res.status(201).json(await clientResponse(req, c));
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
      res.json(await clientResponse(req, c));
    }),
  );

  app.post(
    "/api/clients/:id/regenerate-token",
    requireAdmin,
    wrap(async (req, res) => {
      const c = await db().clients.update(req.params.id, { token: randomToken() });
      if (!c) throw new HttpError(404, "Cliente nao encontrado");
      res.json(await clientResponse(req, c));
    }),
  );

  app.delete(
    "/api/clients/:id",
    requireAdmin,
    wrap(async (req, res) => {
      await db().devices.deleteWhere("client_id", "==", req.params.id);
      await db().clients.delete(req.params.id);
      forgetClient(req.params.id);
      res.json({ ok: true });
    }),
  );

  // ---------- Listas (fontes M3U) ----------
  function readPlaylistBody(body, existing) {
    const kind = str(body.kind ?? existing?.kind, "tipo", { required: true });
    if (!["m3u_url", "xtream", "manual"].includes(kind)) throw new HttpError(400, "Tipo de lista invalido");
    const playback = str(body.playback ?? existing?.playback ?? DEFAULT_PLAYBACK, "reproducao");
    if (!["direct", "proxy"].includes(playback)) throw new HttpError(400, "Modo de reproducao invalido");
    const p = {
      name: str(body.name ?? existing?.name, "nome", { required: true, max: 120 }),
      kind,
      url: str(body.url ?? existing?.url, "url"),
      xtream_server: str(body.xtream_server ?? existing?.xtream_server, "servidor"),
      xtream_username: str(body.xtream_username ?? existing?.xtream_username, "usuario xtream"),
      xtream_password: str(body.xtream_password ?? existing?.xtream_password, "senha xtream"),
      content: String(body.content ?? existing?.content ?? ""),
      epg_url: str(body.epg_url ?? existing?.epg_url, "epg"),
      playback,
      active: !!(body.active ?? existing?.active ?? true),
    };
    if (kind === "m3u_url" && !/^https?:\/\//i.test(p.url)) throw new HttpError(400, "Informe uma URL M3U valida (http/https)");
    if (kind === "xtream" && (!/^https?:\/\//i.test(p.xtream_server) || !p.xtream_username || !p.xtream_password)) {
      throw new HttpError(400, "Informe servidor (http/https), usuario e senha do Xtream");
    }
    if (kind === "manual" && !/#EXTINF/i.test(p.content)) throw new HttpError(400, "Cole um conteudo M3U valido (com #EXTINF)");
    if (kind !== "manual") p.content = "";
    if (Buffer.byteLength(p.content) > MAX_MANUAL_BYTES) {
      throw new HttpError(400, "Lista manual muito grande (limite ~900 KB). Hospede o arquivo e use o tipo URL M3U.");
    }
    return p;
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
      try {
        const text = await loadPlaylistText(p);
        const all = parseEntries(text, Infinity);
        const groups = [...new Set(all.map((e) => e.group).filter(Boolean))];
        res.json({ ok: true, source: sourceUrl(p), channel_count: countChannels(text), groups, entries: all.slice(0, 100) });
      } catch (err) {
        res.json({ ok: false, source: sourceUrl(p), error: err.message });
      }
    }),
  );

  // ---------- Dispositivos (Device ID + Device Key) ----------
  app.get(
    "/api/devices",
    requireAdmin,
    wrap(async (_req, res) => {
      const [devices, clients] = await Promise.all([db().devices.list(), db().clients.list()]);
      const byId = new Map(clients.map((c) => [c.id, c]));
      res.json(
        devices
          .sort(newestFirst)
          .map((d) => ({ ...d, client_username: byId.get(d.client_id)?.username ?? "?", client_name: byId.get(d.client_id)?.name ?? "" })),
      );
    }),
  );

  async function readDeviceBody(body, existing) {
    const mac = normalizeMac(body.mac ?? existing?.mac);
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) throw new HttpError(400, "Device ID invalido (ex: 00:1A:2B:3C:4D:5E)");
    const clientId = String(body.client_id ?? existing?.client_id ?? "");
    const client = clientId && (await db().clients.get(clientId));
    if (!client) throw new HttpError(400, "Selecione um cliente valido");
    const used = (await db().devices.where("client_id", "==", clientId)).filter((d) => d.id !== existing?.id).length;
    if (used >= client.max_devices) throw new HttpError(400, `Cliente atingiu o limite de ${client.max_devices} dispositivo(s)`);
    return {
      mac,
      client_id: clientId,
      device_key: str(body.device_key ?? existing?.device_key, "chave", { max: 64 }) || String(crypto.randomInt(100000, 999999)),
      label: str(body.label ?? existing?.label, "descricao", { max: 120 }),
    };
  }

  app.get(
    "/api/devices/pending",
    requireAdmin,
    wrap(async (_req, res) => {
      const pending = await db().pending.list();
      res.json(pending.sort(newestFirst).map(({ id, ...p }) => ({ device_id: id, ...p })));
    }),
  );

  app.delete(
    "/api/devices/pending/:id",
    requireAdmin,
    wrap(async (req, res) => {
      await db().pending.delete(normalizeMac(req.params.id));
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/devices",
    requireAdmin,
    wrap(async (req, res) => {
      const data = await readDeviceBody(req.body || {});
      const d = await unique(() => db().devices.create({ ...data, last_seen_at: null }));
      await db().pending.delete(d.mac);
      res.status(201).json(d);
    }),
  );

  app.put(
    "/api/devices/:id",
    requireAdmin,
    wrap(async (req, res) => {
      const existing = await db().devices.get(req.params.id);
      if (!existing) throw new HttpError(404, "Dispositivo nao encontrado");
      const data = await readDeviceBody(req.body || {}, existing);
      res.json(await unique(() => db().devices.update(existing.id, data)));
    }),
  );

  app.delete(
    "/api/devices/:id",
    requireAdmin,
    wrap(async (req, res) => {
      await db().devices.delete(req.params.id);
      res.json({ ok: true });
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
      for (const p of await clientPlaylists(c)) {
        let text;
        try {
          text = await loadPlaylistText(p);
        } catch {
          continue;
        }
        playlists.push({ id: p.id, name: p.name });
        const viaProxy = (p.playback || DEFAULT_PLAYBACK) === "proxy";
        const link = (url) => (viaProxy ? proxyUrl(c.id, url) : url);
        for (const e of parseEntries(text, Infinity)) {
          if (!/^https?:\/\//i.test(e.url)) continue;
          // Servidores Xtream entregam o mesmo canal em HLS (.m3u8), que toca em mais aparelhos (ex: iPhone).
          const hlsUrl = /\/live\/.+\.ts$/i.test(e.url.split("?")[0]) ? e.url.replace(/\.ts(\?|$)/i, ".m3u8$1") : "";
          // Sem proxy, o navegador vai direto na fonte: prefere HLS, que costuma funcionar melhor assim.
          const [main, alt] = !viaProxy && hlsUrl ? [hlsUrl, e.url] : [e.url, hlsUrl];
          channels.push({
            id: crypto.createHash("sha1").update(`${p.id}|${e.url}`).digest("hex").slice(0, 12),
            name: e.name,
            group: e.group || p.name,
            logo: /^https?:\/\//i.test(e.logo) ? link(e.logo) : "",
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
      res.json({ playlists, channels });
    }),
  );

  // Guia de programacao: agora / a seguir para os canais pedidos (ids tvg-id separados por virgula).
  app.get(
    "/api/player/epg",
    requireClient,
    wrap(async (req, res) => {
      const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 300);
      const urls = new Set();
      for (const p of await clientPlaylists(req.client)) {
        if (p.epg_url) urls.add(p.epg_url);
        try {
          headerEpgUrls(await loadPlaylistText(p)).forEach((u) => urls.add(u));
        } catch {
          /* lista fora do ar: segue sem o EPG dela */
        }
      }
      res.json(ids.length && urls.size ? await nowNext([...urls], ids) : {});
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

  // ---------- Ativacao por codigo do aparelho (Device ID + Device Key, com QR code) ----------
  // O reprodutor gera ID e chave, registra aqui e fica consultando ate o revendedor vincular a um cliente.
  app.post(
    "/api/player/device/register",
    wrap(async (req, res) => {
      const id = normalizeMac(req.body?.device_id);
      const key = String(req.body?.device_key || "");
      if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(id) || !/^\d{6}$/.test(key)) throw new HttpError(400, "Codigo do aparelho invalido");
      const linked = await db().devices.findOne("mac", id);
      if (linked && linked.device_key !== key) throw new HttpError(409, "Este ID ja pertence a outro aparelho");
      if (!linked) {
        const pending = await db().pending.get(id);
        if (pending && pending.device_key !== key) throw new HttpError(409, "Este ID ja pertence a outro aparelho");
        if (!pending) {
          const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
          await db().pending.deleteWhere("created_at", "<", weekAgo);
          await db().pending.set(id, { device_key: key, user_agent: String(req.get("user-agent") || "").slice(0, 300), created_at: nowIso() });
        }
      }
      res.json({ device_id: id, linked: !!linked });
    }),
  );

  app.get(
    "/api/player/device/status",
    wrap(async (req, res) => {
      const d = await db().devices.findOne("mac", normalizeMac(req.query.device_id));
      if (!d || d.device_key !== String(req.query.device_key || "")) return res.json({ linked: false });
      const c = await getClient(d.client_id);
      if (!isClientValid(c)) throw new HttpError(403, "Acesso expirado ou bloqueado. Fale com seu revendedor.");
      await touch("devices", d, "last_seen_at");
      await touch("clients", c, "last_access_at");
      signClientSession(res, req, c);
      res.json({ linked: true, profile: clientProfile(c) });
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
      if (req.headers.range) headers.Range = req.headers.range;
      let upstream;
      try {
        upstream = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
      } catch {
        if (!res.headersSent && !controller.signal.aborted) res.status(502).json({ error: "Falha ao conectar na fonte" });
        return;
      }
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
      Readable.fromWeb(upstream.body)
        .on("error", () => res.destroy())
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

  // Ativacao por dispositivo para apps externos: o app envia ID + chave e recebe a lista.
  app.get(
    "/api/device/playlists",
    wrap(async (req, res) => {
      const d = await db().devices.findOne("mac", normalizeMac(req.query.mac));
      if (!d || d.device_key !== String(req.query.key || "")) throw new HttpError(401, "Dispositivo nao ativado");
      const c = await getClient(d.client_id);
      if (!isClientValid(c)) throw new HttpError(403, "Acesso expirado ou bloqueado");
      await touch("devices", d, "last_seen_at");
      await touch("clients", c, "last_access_at");
      res.json({ mac: d.mac, expires_at: c.expires_at, playlists: [{ name: c.name || c.username, url: clientLinks(req, c).m3u_token }] });
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
