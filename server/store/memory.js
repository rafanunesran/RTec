// Banco em memoria com a mesma interface do Firestore. Usado nos testes e no desenvolvimento local
// sem credenciais do Firebase (os dados somem quando o servidor reinicia).
import crypto from "node:crypto";
import { DuplicateError, now } from "./errors.js";

const clone = (v) => (v == null ? v : structuredClone(v));

function match(doc, field, op, value) {
  const v = doc[field];
  if (op === "==") return v === value;
  if (op === "<") return v != null && v < value;
  if (op === "array-contains") return Array.isArray(v) && v.includes(value);
  throw new Error(`Operador nao suportado: ${op}`);
}

class MemoryCollection {
  constructor(unique = []) {
    this.unique = unique;
    this.docs = new Map();
  }

  checkUnique(id, data) {
    for (const field of this.unique) {
      if (data[field] === undefined) continue;
      for (const [otherId, doc] of this.docs) if (otherId !== id && doc[field] === data[field]) throw new DuplicateError(field);
    }
  }

  async list() {
    return [...this.docs.entries()].map(([id, d]) => ({ id, ...clone(d) }));
  }

  async get(id) {
    const d = this.docs.get(String(id));
    return d ? { id: String(id), ...clone(d) } : null;
  }

  async where(field, op, value) {
    return (await this.list()).filter((d) => match(d, field, op, value));
  }

  async findOne(field, value) {
    return (await this.where(field, "==", value))[0] ?? null;
  }

  async create(data, id = crypto.randomUUID().replace(/-/g, "").slice(0, 20)) {
    if (this.docs.has(id)) throw new DuplicateError("id");
    this.checkUnique(id, data);
    this.docs.set(id, clone({ created_at: now(), ...data }));
    return this.get(id);
  }

  async set(id, data) {
    this.checkUnique(id, data);
    this.docs.set(String(id), clone(data));
    return this.get(id);
  }

  async update(id, patch) {
    const current = this.docs.get(String(id));
    if (!current) return null;
    this.checkUnique(String(id), patch);
    this.docs.set(String(id), clone({ ...current, ...patch }));
    return this.get(id);
  }

  async delete(id) {
    this.docs.delete(String(id));
  }

  async deleteWhere(field, op, value) {
    for (const d of await this.where(field, op, value)) this.docs.delete(d.id);
  }
}

export function createMemoryStore() {
  const config = new MemoryCollection();
  return {
    kind: "memory",
    admins: new MemoryCollection(["username"]),
    clients: new MemoryCollection(["username"]),
    playlists: new MemoryCollection(),
    sync: new MemoryCollection(),
    profiles: new MemoryCollection(),
    alerts: new MemoryCollection(),
    config,
    async getOrCreateSecret(generate) {
      const doc = await config.get("secrets");
      if (doc?.jwt) return doc.jwt;
      const jwt = generate();
      await config.set("secrets", { jwt });
      return jwt;
    },
  };
}
