import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { db } from "./db.js";
import { buildMergedM3u, countChannels, headerEpgUrls, loadPlaylistText, parseEntries, sourceUrl } from "./m3u.js";
import { nowNext } from "./epg.js";

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(process.env.DATA_DIR || path.resolve("data"), ".jwt-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const JWT_SECRET = loadSecret();
const COOKIE = "rtec_session";
const CLIENT_COOKIE = "rtec_player";

const randomToken = () => crypto.randomBytes(16).toString("hex");
const randomPassword = () => crypto.randomBytes(6).toString("base64url");
const normalizeMac = (mac) => String(mac || "").toUpperCase().replace(/[^0-9A-F]/g, "").replace(/(..)(?!$)/g, "$1:");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireAdmin(req, _res, next) {
  try {
    req.admin = jwt.verify(req.cookies[COOKIE], JWT_SECRET);
    next();
  } catch {
    next(new HttpError(401, "Nao autenticado"));
  }
}

function isClientValid(c) {
  if (!c || !c.active) return false;
  return !c.expires_at || new Date(c.expires_at) > new Date();
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

function requireClient(req, _res, next) {
  try {
    const payload = jwt.verify(req.cookies[CLIENT_COOKIE], JWT_SECRET);
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(payload.cid);
    if (!c || payload.pw !== passwordFingerprint(c)) return next(new HttpError(401, "Sessao expirada, entre novamente"));
    if (!isClientValid(c)) return next(new HttpError(403, "Acesso expirado ou bloqueado. Fale com seu revendedor."));
    req.client = c;
    next();
  } catch {
    next(new HttpError(401, "Nao autenticado"));
  }
}

function clientPlaylists(clientId) {
  return db
    .prepare(
      `SELECT p.* FROM playlists p
       JOIN client_playlists cp ON cp.playlist_id = p.id
       WHERE cp.client_id = ? AND p.active = 1 ORDER BY p.name`,
    )
    .all(clientId);
}

function touchClient(id) {
  db.prepare("UPDATE clients SET last_access_at = datetime('now') WHERE id = ?").run(id);
}

function serializeClient(c) {
  const playlistIds = db.prepare("SELECT playlist_id FROM client_playlists WHERE client_id = ?").all(c.id).map((r) => r.playlist_id);
  const deviceCount = db.prepare("SELECT COUNT(*) AS n FROM devices WHERE client_id = ?").get(c.id).n;
  const { parental_pin_hash, locked_groups: _locked, ...rest } = c;
  return { ...rest, active: !!c.active, playlist_ids: playlistIds, device_count: deviceCount, valid: isClientValid(c), custom_pin: !!parental_pin_hash };
}

function setClientPlaylists(clientId, ids) {
  if (!Array.isArray(ids)) return;
  db.prepare("DELETE FROM client_playlists WHERE client_id = ?").run(clientId);
  const ins = db.prepare("INSERT OR IGNORE INTO client_playlists (client_id, playlist_id) VALUES (?, ?)");
  for (const id of ids) ins.run(clientId, Number(id));
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
  touchClient(client.id);
  const text = await buildMergedM3u(clientPlaylists(client.id));
  res.setHeader("Content-Type", "audio/x-mpegurl; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${client.username}.m3u"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(text);
}

export function createApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "20mb" }));
  app.use(cookieParser());

  // ---------- Autenticacao do administrador ----------
  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body || {};
    const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(String(username || ""));
    if (!admin || !bcrypt.compareSync(String(password || ""), admin.password_hash)) {
      throw new HttpError(401, "Usuario ou senha invalidos");
    }
    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      maxAge: 7 * 24 * 3600 * 1000,
    });
    res.json({ id: admin.id, username: admin.username });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAdmin, (req, res) => res.json(req.admin));

  app.post("/api/auth/password", requireAdmin, (req, res) => {
    const { current, next } = req.body || {};
    const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.admin.id);
    if (!admin || !bcrypt.compareSync(String(current || ""), admin.password_hash)) {
      throw new HttpError(400, "Senha atual incorreta");
    }
    if (String(next || "").length < 6) throw new HttpError(400, "A nova senha precisa ter ao menos 6 caracteres");
    db.prepare("UPDATE admins SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(String(next), 10), admin.id);
    res.json({ ok: true });
  });

  // ---------- Painel ----------
  app.get("/api/stats", requireAdmin, (_req, res) => {
    const clients = db.prepare("SELECT * FROM clients").all();
    res.json({
      clients: clients.length,
      active_clients: clients.filter(isClientValid).length,
      expired_clients: clients.filter((c) => c.expires_at && new Date(c.expires_at) <= new Date()).length,
      playlists: db.prepare("SELECT COUNT(*) AS n FROM playlists").get().n,
      devices: db.prepare("SELECT COUNT(*) AS n FROM devices").get().n,
      recent: db
        .prepare("SELECT id, name, username, last_access_at FROM clients WHERE last_access_at IS NOT NULL ORDER BY last_access_at DESC LIMIT 8")
        .all(),
    });
  });

  // ---------- Clientes (login/senha) ----------
  app.get("/api/clients", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT * FROM clients ORDER BY created_at DESC").all();
    res.json(rows.map((c) => ({ ...serializeClient(c), links: clientLinks(req, c) })));
  });

  function readClientBody(body, existing) {
    const username = str(body.username ?? existing?.username, "usuario", { required: true, max: 64 });
    if (!/^[A-Za-z0-9._-]+$/.test(username)) throw new HttpError(400, "Usuario deve conter apenas letras, numeros, ponto, _ ou -");
    const password = str(body.password ?? existing?.password, "senha", { max: 64 }) || randomPassword();
    const expires = body.expires_at === undefined ? existing?.expires_at ?? null : body.expires_at || null;
    if (expires && Number.isNaN(new Date(expires).getTime())) throw new HttpError(400, "Data de validade invalida");
    return {
      name: str(body.name ?? existing?.name, "nome", { max: 120 }),
      username,
      password,
      active: (body.active ?? existing?.active ?? true) ? 1 : 0,
      max_devices: Math.max(1, Number(body.max_devices ?? existing?.max_devices ?? 1) || 1),
      expires_at: expires,
      notes: str(body.notes ?? existing?.notes, "observacoes"),
    };
  }

  function uniqueGuard(fn) {
    try {
      return fn();
    } catch (err) {
      if (/UNIQUE/.test(err.message)) throw new HttpError(409, "Ja existe um registro com esse valor (usuario/MAC)");
      throw err;
    }
  }

  app.post("/api/clients", requireAdmin, (req, res) => {
    const c = readClientBody(req.body || {});
    const { lastInsertRowid } = uniqueGuard(() =>
      db
        .prepare(
          `INSERT INTO clients (name, username, password, token, active, max_devices, expires_at, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(c.name, c.username, c.password, randomToken(), c.active, c.max_devices, c.expires_at, c.notes),
    );
    setClientPlaylists(Number(lastInsertRowid), req.body.playlist_ids);
    const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(lastInsertRowid);
    res.status(201).json({ ...serializeClient(row), links: clientLinks(req, row) });
  });

  app.put("/api/clients/:id", requireAdmin, (req, res) => {
    const existing = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
    if (!existing) throw new HttpError(404, "Cliente nao encontrado");
    const c = readClientBody(req.body || {}, existing);
    uniqueGuard(() =>
      db
        .prepare(
          `UPDATE clients SET name=?, username=?, password=?, active=?, max_devices=?, expires_at=?, notes=? WHERE id=?`,
        )
        .run(c.name, c.username, c.password, c.active, c.max_devices, c.expires_at, c.notes, existing.id),
    );
    setClientPlaylists(existing.id, req.body.playlist_ids);
    // O revendedor pode voltar o PIN parental para o padrao (0000) quando o cliente esquecer.
    if (req.body.reset_pin) db.prepare("UPDATE clients SET parental_pin_hash = '' WHERE id = ?").run(existing.id);
    const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(existing.id);
    res.json({ ...serializeClient(row), links: clientLinks(req, row) });
  });

  app.post("/api/clients/:id/regenerate-token", requireAdmin, (req, res) => {
    db.prepare("UPDATE clients SET token = ? WHERE id = ?").run(randomToken(), req.params.id);
    const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
    if (!row) throw new HttpError(404, "Cliente nao encontrado");
    res.json({ ...serializeClient(row), links: clientLinks(req, row) });
  });

  app.delete("/api/clients/:id", requireAdmin, (req, res) => {
    db.prepare("DELETE FROM clients WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Listas (fontes M3U) ----------
  function readPlaylistBody(body, existing) {
    const kind = str(body.kind ?? existing?.kind, "tipo", { required: true });
    if (!["m3u_url", "xtream", "manual"].includes(kind)) throw new HttpError(400, "Tipo de lista invalido");
    const p = {
      name: str(body.name ?? existing?.name, "nome", { required: true, max: 120 }),
      kind,
      url: str(body.url ?? existing?.url, "url"),
      xtream_server: str(body.xtream_server ?? existing?.xtream_server, "servidor"),
      xtream_username: str(body.xtream_username ?? existing?.xtream_username, "usuario xtream"),
      xtream_password: str(body.xtream_password ?? existing?.xtream_password, "senha xtream"),
      content: body.content ?? existing?.content ?? "",
      epg_url: str(body.epg_url ?? existing?.epg_url, "epg"),
      active: (body.active ?? existing?.active ?? true) ? 1 : 0,
    };
    if (kind === "m3u_url" && !/^https?:\/\//i.test(p.url)) throw new HttpError(400, "Informe uma URL M3U valida (http/https)");
    if (kind === "xtream" && (!/^https?:\/\//i.test(p.xtream_server) || !p.xtream_username || !p.xtream_password)) {
      throw new HttpError(400, "Informe servidor (http/https), usuario e senha do Xtream");
    }
    if (kind === "manual" && !/#EXTINF/i.test(p.content)) throw new HttpError(400, "Cole um conteudo M3U valido (com #EXTINF)");
    return p;
  }

  const serializePlaylist = (p) => {
    const clients = db.prepare("SELECT COUNT(*) AS n FROM client_playlists WHERE playlist_id = ?").get(p.id).n;
    return { ...p, active: !!p.active, client_count: clients, content: p.kind === "manual" ? p.content : "", channel_count: p.kind === "manual" ? countChannels(p.content) : null };
  };

  app.get("/api/playlists", requireAdmin, (_req, res) => {
    res.json(db.prepare("SELECT * FROM playlists ORDER BY name").all().map(serializePlaylist));
  });

  app.post("/api/playlists", requireAdmin, (req, res) => {
    const p = readPlaylistBody(req.body || {});
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO playlists (name, kind, url, xtream_server, xtream_username, xtream_password, content, epg_url, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.name, p.kind, p.url, p.xtream_server, p.xtream_username, p.xtream_password, p.content, p.epg_url, p.active);
    res.status(201).json(serializePlaylist(db.prepare("SELECT * FROM playlists WHERE id = ?").get(lastInsertRowid)));
  });

  app.put("/api/playlists/:id", requireAdmin, (req, res) => {
    const existing = db.prepare("SELECT * FROM playlists WHERE id = ?").get(req.params.id);
    if (!existing) throw new HttpError(404, "Lista nao encontrada");
    const p = readPlaylistBody(req.body || {}, existing);
    db.prepare(
      `UPDATE playlists SET name=?, kind=?, url=?, xtream_server=?, xtream_username=?, xtream_password=?, content=?, epg_url=?, active=? WHERE id=?`,
    ).run(p.name, p.kind, p.url, p.xtream_server, p.xtream_username, p.xtream_password, p.content, p.epg_url, p.active, existing.id);
    res.json(serializePlaylist(db.prepare("SELECT * FROM playlists WHERE id = ?").get(existing.id)));
  });

  app.delete("/api/playlists/:id", requireAdmin, (req, res) => {
    db.prepare("DELETE FROM playlists WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  app.get(
    "/api/playlists/:id/preview",
    requireAdmin,
    wrap(async (req, res) => {
      const p = db.prepare("SELECT * FROM playlists WHERE id = ?").get(req.params.id);
      if (!p) throw new HttpError(404, "Lista nao encontrada");
      try {
        const text = await loadPlaylistText(p);
        const entries = parseEntries(text, 100);
        const groups = [...new Set(parseEntries(text, 100000).map((e) => e.group).filter(Boolean))];
        res.json({ ok: true, source: sourceUrl(p), channel_count: countChannels(text), groups, entries });
      } catch (err) {
        res.json({ ok: false, source: sourceUrl(p), error: err.message });
      }
    }),
  );

  // ---------- Dispositivos (MAC + chave) ----------
  app.get("/api/devices", requireAdmin, (_req, res) => {
    res.json(
      db
        .prepare(
          `SELECT d.*, c.username AS client_username, c.name AS client_name
           FROM devices d JOIN clients c ON c.id = d.client_id ORDER BY d.created_at DESC`,
        )
        .all(),
    );
  });

  function readDeviceBody(body, existing) {
    const mac = normalizeMac(body.mac ?? existing?.mac);
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) throw new HttpError(400, "MAC invalido (ex: 00:1A:2B:3C:4D:5E)");
    const clientId = Number(body.client_id ?? existing?.client_id);
    const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(clientId);
    if (!client) throw new HttpError(400, "Selecione um cliente valido");
    const used = db.prepare("SELECT COUNT(*) AS n FROM devices WHERE client_id = ? AND id != ?").get(clientId, existing?.id ?? 0).n;
    if (used >= client.max_devices) throw new HttpError(400, `Cliente atingiu o limite de ${client.max_devices} dispositivo(s)`);
    return {
      mac,
      client_id: clientId,
      device_key: str(body.device_key ?? existing?.device_key, "chave", { max: 64 }) || String(crypto.randomInt(100000, 999999)),
      label: str(body.label ?? existing?.label, "descricao", { max: 120 }),
    };
  }

  app.get("/api/devices/pending", requireAdmin, (_req, res) => {
    res.json(db.prepare("SELECT * FROM pending_devices ORDER BY created_at DESC").all());
  });

  app.delete("/api/devices/pending/:id", requireAdmin, (req, res) => {
    db.prepare("DELETE FROM pending_devices WHERE device_id = ?").run(normalizeMac(req.params.id));
    res.json({ ok: true });
  });

  app.post("/api/devices", requireAdmin, (req, res) => {
    const d = readDeviceBody(req.body || {});
    const { lastInsertRowid } = uniqueGuard(() =>
      db.prepare("INSERT INTO devices (client_id, mac, device_key, label) VALUES (?, ?, ?, ?)").run(d.client_id, d.mac, d.device_key, d.label),
    );
    db.prepare("DELETE FROM pending_devices WHERE device_id = ?").run(d.mac);
    res.status(201).json(db.prepare("SELECT * FROM devices WHERE id = ?").get(lastInsertRowid));
  });

  app.put("/api/devices/:id", requireAdmin, (req, res) => {
    const existing = db.prepare("SELECT * FROM devices WHERE id = ?").get(req.params.id);
    if (!existing) throw new HttpError(404, "Dispositivo nao encontrado");
    const d = readDeviceBody(req.body || {}, existing);
    uniqueGuard(() =>
      db.prepare("UPDATE devices SET client_id=?, mac=?, device_key=?, label=? WHERE id=?").run(d.client_id, d.mac, d.device_key, d.label, existing.id),
    );
    res.json(db.prepare("SELECT * FROM devices WHERE id = ?").get(existing.id));
  });

  app.delete("/api/devices/:id", requireAdmin, (req, res) => {
    db.prepare("DELETE FROM devices WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Reprodutor do cliente ----------
  app.post("/api/player/login", (req, res) => {
    const { username, password } = req.body || {};
    const c = db.prepare("SELECT * FROM clients WHERE username = ? AND password = ?").get(String(username || ""), String(password || ""));
    if (!c) throw new HttpError(401, "Usuario ou senha invalidos");
    if (!isClientValid(c)) throw new HttpError(403, "Acesso expirado ou bloqueado. Fale com seu revendedor.");
    touchClient(c.id);
    const token = jwt.sign({ cid: c.id, pw: passwordFingerprint(c) }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie(CLIENT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 30 * 24 * 3600 * 1000 });
    res.json(clientProfile(c));
  });

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
      touchClient(c.id);
      const channels = [];
      const playlists = [];
      for (const p of clientPlaylists(c.id)) {
        let text;
        try {
          text = await loadPlaylistText(p);
        } catch {
          continue;
        }
        playlists.push({ id: p.id, name: p.name });
        for (const e of parseEntries(text, Infinity)) {
          if (!/^https?:\/\//i.test(e.url)) continue;
          channels.push({
            id: crypto.createHash("sha1").update(`${p.id}|${e.url}`).digest("hex").slice(0, 12),
            name: e.name,
            group: e.group || p.name,
            logo: /^https?:\/\//i.test(e.logo) ? proxyUrl(c.id, e.logo) : "",
            src: proxyUrl(c.id, e.url),
            type: streamType(e.url),
            kind: e.kind,
            epg_id: e.tvg_id,
            playlist_id: p.id,
            // Servidores Xtream entregam o mesmo canal em HLS; usado quando o aparelho nao toca MPEG-TS (ex: iPhone).
            alt: /\/live\/.+\.ts$/i.test(e.url.split("?")[0]) ? proxyUrl(c.id, e.url.replace(/\.ts(\?|$)/i, ".m3u8$1")) : "",
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
      for (const p of clientPlaylists(req.client.id)) {
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
  const DEFAULT_PIN = "0000";
  const checkPin = (c, pin) => (c.parental_pin_hash ? bcrypt.compareSync(String(pin || ""), c.parental_pin_hash) : String(pin || "") === DEFAULT_PIN);

  app.get("/api/player/settings", requireClient, (req, res) => {
    res.json({ custom_pin: !!req.client.parental_pin_hash, locked_groups: JSON.parse(req.client.locked_groups || "[]") });
  });

  app.post("/api/player/pin/verify", requireClient, (req, res) => {
    if (!checkPin(req.client, req.body?.pin)) throw new HttpError(403, "PIN incorreto");
    res.json({ ok: true });
  });

  app.post("/api/player/pin", requireClient, (req, res) => {
    const { current, pin } = req.body || {};
    if (!checkPin(req.client, current)) throw new HttpError(403, "PIN atual incorreto");
    if (!/^\d{4,8}$/.test(String(pin || ""))) throw new HttpError(400, "O PIN deve ter de 4 a 8 numeros");
    db.prepare("UPDATE clients SET parental_pin_hash = ? WHERE id = ?").run(bcrypt.hashSync(String(pin), 10), req.client.id);
    res.json({ ok: true });
  });

  app.post("/api/player/locked-groups", requireClient, (req, res) => {
    const { pin, groups } = req.body || {};
    if (!checkPin(req.client, pin)) throw new HttpError(403, "PIN incorreto");
    if (!Array.isArray(groups)) throw new HttpError(400, "Lista de grupos invalida");
    const clean = [...new Set(groups.map((g) => String(g).slice(0, 200)))].slice(0, 500);
    db.prepare("UPDATE clients SET locked_groups = ? WHERE id = ?").run(JSON.stringify(clean), req.client.id);
    res.json({ locked_groups: clean });
  });

  // ---------- Ativacao por codigo do aparelho (Device ID + Device Key, com QR code) ----------
  // O reprodutor gera ID e chave, registra aqui e fica consultando ate o revendedor vincular a um cliente.
  app.post("/api/player/device/register", (req, res) => {
    const id = normalizeMac(req.body?.device_id);
    const key = String(req.body?.device_key || "");
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(id) || !/^\d{6}$/.test(key)) throw new HttpError(400, "Codigo do aparelho invalido");
    const linked = db.prepare("SELECT device_key FROM devices WHERE mac = ?").get(id);
    if (linked && linked.device_key !== key) throw new HttpError(409, "Este ID ja pertence a outro aparelho");
    if (!linked) {
      db.prepare("DELETE FROM pending_devices WHERE created_at < datetime('now', '-7 days')").run();
      const pending = db.prepare("SELECT device_key FROM pending_devices WHERE device_id = ?").get(id);
      if (pending && pending.device_key !== key) throw new HttpError(409, "Este ID ja pertence a outro aparelho");
      if (!pending) {
        db.prepare("INSERT INTO pending_devices (device_id, device_key, user_agent) VALUES (?, ?, ?)").run(
          id,
          key,
          String(req.get("user-agent") || "").slice(0, 300),
        );
      }
    }
    res.json({ device_id: id, linked: !!linked });
  });

  app.get("/api/player/device/status", (req, res) => {
    const id = normalizeMac(req.query.device_id);
    const d = db.prepare("SELECT * FROM devices WHERE mac = ?").get(id);
    if (!d || d.device_key !== String(req.query.device_key || "")) return res.json({ linked: false });
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(d.client_id);
    if (!isClientValid(c)) throw new HttpError(403, "Acesso expirado ou bloqueado. Fale com seu revendedor.");
    db.prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?").run(d.id);
    touchClient(c.id);
    const token = jwt.sign({ cid: c.id, pw: passwordFingerprint(c) }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie(CLIENT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 30 * 24 * 3600 * 1000 });
    res.json({ linked: true, profile: clientProfile(c) });
  });

  // Repassa streams e logos pelo servidor: evita bloqueio de CORS e de conteudo http em site https.
  // So aceita URLs assinadas pelo proprio servidor para o cliente logado (nao e um proxy aberto).
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
      const c = db.prepare("SELECT * FROM clients WHERE username = ? AND password = ?").get(String(req.query.username || ""), String(req.query.password || ""));
      if (!isClientValid(c)) return res.status(401).type("text").send("Unauthorized");
      await sendM3u(res, c);
    }),
  );

  app.get(
    "/m3u/:token.m3u",
    wrap(async (req, res) => {
      const c = db.prepare("SELECT * FROM clients WHERE token = ?").get(req.params.token);
      if (!isClientValid(c)) return res.status(401).type("text").send("Unauthorized");
      await sendM3u(res, c);
    }),
  );

  // Ativacao por dispositivo (estilo Duplecast): o app envia MAC + chave e recebe as listas.
  app.get("/api/device/playlists", (req, res) => {
    const d = db.prepare("SELECT * FROM devices WHERE mac = ?").get(normalizeMac(req.query.mac));
    if (!d || d.device_key !== String(req.query.key || "")) throw new HttpError(401, "Dispositivo nao ativado");
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(d.client_id);
    if (!isClientValid(c)) throw new HttpError(403, "Acesso expirado ou bloqueado");
    db.prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?").run(d.id);
    touchClient(c.id);
    const links = clientLinks(req, c);
    res.json({
      mac: d.mac,
      expires_at: c.expires_at,
      playlists: [{ name: c.name || c.username, url: links.m3u_token }],
    });
  });

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Rota nao encontrada")));

  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Erro interno" : err.message });
  });

  return app;
}
