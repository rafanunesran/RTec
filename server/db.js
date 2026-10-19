import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

const dataDir = process.env.DATA_DIR || path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(process.env.DB_FILE || path.join(dataDir, "rtec.db"));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Linhas de acesso dos clientes (login/senha usados no app IPTV)
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  max_devices INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  last_access_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fontes de listas: URL M3U, servidor Xtream ou conteudo M3U colado
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('m3u_url', 'xtream', 'manual')),
  url TEXT NOT NULL DEFAULT '',
  xtream_server TEXT NOT NULL DEFAULT '',
  xtream_username TEXT NOT NULL DEFAULT '',
  xtream_password TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  epg_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_playlists (
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, playlist_id)
);

-- Dispositivos ativados no estilo Duplecast (MAC + chave do aparelho)
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  mac TEXT NOT NULL UNIQUE,
  device_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function seedAdmin() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM admins").get().n;
  if (count > 0) return;
  const username = process.env.ADMIN_USER || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  db.prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)").run(
    username,
    bcrypt.hashSync(password, 10),
  );
  console.log(`[rtec] Admin inicial criado: ${username} / ${process.env.ADMIN_PASSWORD ? "(ADMIN_PASSWORD)" : password}`);
}
