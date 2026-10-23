// Cifra (AES-256-GCM) para nao deixar links e senhas do fornecedor legiveis fora do servidor.
import crypto from "node:crypto";

const key = (secret, label) => crypto.createHash("sha256").update(`${label}|${secret}`).digest();

/**
 * Link do fornecedor dentro do link do proxy: o aparelho recebe so um codigo ("x...") em vez da URL com
 * usuario/senha. Deterministico (o mesmo link gera o mesmo codigo), para o navegador aproveitar o cache.
 */
export function sealUrl(secret, url) {
  const k = key(secret, "rtec-url-v1");
  const iv = crypto.createHmac("sha256", k).update(url).digest().subarray(0, 12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(url, "utf8"), c.final()]);
  return `x${Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64url")}`;
}

/** Abre o codigo de sealUrl; "" se foi alterado ou cifrado com outro segredo. */
export function openUrl(secret, token) {
  if (!/^x[\w-]{40,}$/.test(String(token || ""))) return "";
  try {
    const raw = Buffer.from(token.slice(1), "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key(secret, "rtec-url-v1"), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

// ---------- Dados guardados no banco (DATA_KEY) ----------
const PREFIX = "enc1:";
const SOURCE_FIELDS = ["url", "xtream_server", "xtream_username", "xtream_password", "epg_url"];

const dataKey = () => (process.env.DATA_KEY || "").trim();
export const hasDataKey = () => !!dataKey();
export const isSealed = (v) => typeof v === "string" && v.startsWith(PREFIX);

function sealValue(v) {
  if (!hasDataKey() || typeof v !== "string" || !v || isSealed(v)) return v;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(dataKey(), "rtec-data-v1"), iv);
  const ct = Buffer.concat([c.update(v, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64url");
}

function openValue(v) {
  if (!isSealed(v)) return v;
  if (!hasDataKey()) throw new Error("Dados cifrados no banco, mas a variavel DATA_KEY nao esta configurada no servidor.");
  try {
    const raw = Buffer.from(v.slice(PREFIX.length), "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key(dataKey(), "rtec-data-v1"), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString("utf8");
  } catch {
    throw new Error("Nao foi possivel abrir os dados cifrados: a DATA_KEY do servidor e diferente da usada para cifrar.");
  }
}

const mapSource = (p, fn) => {
  if (!p || typeof p !== "object") return p;
  const out = { ...p };
  for (const f of SOURCE_FIELDS) if (f in out) out[f] = fn(out[f]);
  return out;
};

/** Campos com link/usuario/senha do fornecedor: lista avulsa (playlists) e listas do cliente (source, extra_sources). */
const transforms = {
  playlists: (doc, fn) => mapSource(doc, fn),
  clients: (doc, fn) => {
    if (!doc || typeof doc !== "object") return doc;
    const out = { ...doc };
    if ("source" in out) out.source = mapSource(out.source, fn);
    if (Array.isArray(out.extra_sources)) out.extra_sources = out.extra_sources.map((p) => mapSource(p, fn));
    return out;
  },
};

/** Tem algum campo ainda sem cifra (para cifrar o que ja estava no banco). */
export function needsSeal(name, doc) {
  let plain = false;
  transforms[name]?.(doc, (v) => ((plain ||= typeof v === "string" && !!v && !isSealed(v)), v));
  return plain;
}

/**
 * Embrulha uma colecao do banco: cifra ao gravar e abre ao ler. Sem DATA_KEY grava normal (e ainda le
 * o que nao estiver cifrado).
 */
export function sealCollection(name, col) {
  const t = transforms[name];
  if (!t) return col;
  const seal = (d) => t(d, sealValue);
  const open = (d) => (d ? t(d, openValue) : d);
  return Object.assign(Object.create(col), {
    list: async () => (await col.list()).map(open),
    get: async (id) => open(await col.get(id)),
    where: async (...a) => (await col.where(...a)).map(open),
    findOne: async (...a) => open(await col.findOne(...a)),
    create: async (data, ...rest) => open(await col.create(seal(data), ...rest)),
    set: async (id, data) => open(await col.set(id, seal(data))),
    update: async (id, patch) => open(await col.update(id, seal(patch))),
  });
}
