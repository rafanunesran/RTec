// Banco no Firestore (Firebase). So o servidor acessa, com a conta de servico (Admin SDK);
// as regras do Firestore bloqueiam qualquer acesso direto pelo navegador.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { DuplicateError, now } from "./errors.js";

function credentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(json);
  }
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }
  return null;
}

class FirestoreCollection {
  constructor(db, name, unique = []) {
    this.db = db;
    this.ref = db.collection(name);
    this.unique = unique;
  }

  static toObj(snap) {
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  }

  async checkUnique(t, id, data) {
    for (const field of this.unique) {
      if (data[field] === undefined) continue;
      const snap = await t.get(this.ref.where(field, "==", data[field]).limit(2));
      if (snap.docs.some((d) => d.id !== id)) throw new DuplicateError(field);
    }
  }

  async list() {
    const snap = await this.ref.get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async get(id) {
    return FirestoreCollection.toObj(await this.ref.doc(String(id)).get());
  }

  async where(field, op, value) {
    const snap = await this.ref.where(field, op, value).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async findOne(field, value) {
    const snap = await this.ref.where(field, "==", value).limit(1).get();
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  async create(data, id = this.ref.doc().id) {
    const doc = this.ref.doc(id);
    await this.db.runTransaction(async (t) => {
      if ((await t.get(doc)).exists) throw new DuplicateError("id");
      await this.checkUnique(t, id, data);
      t.set(doc, { created_at: now(), ...data });
    });
    return this.get(id);
  }

  async set(id, data) {
    const doc = this.ref.doc(String(id));
    await this.db.runTransaction(async (t) => {
      await this.checkUnique(t, String(id), data);
      t.set(doc, data);
    });
    return this.get(id);
  }

  async update(id, patch) {
    const doc = this.ref.doc(String(id));
    const ok = await this.db.runTransaction(async (t) => {
      if (!(await t.get(doc)).exists) return false;
      await this.checkUnique(t, String(id), patch);
      t.update(doc, patch);
      return true;
    });
    return ok ? this.get(id) : null;
  }

  async delete(id) {
    await this.ref.doc(String(id)).delete();
  }

  async deleteWhere(field, op, value) {
    const snap = await this.ref.where(field, op, value).get();
    if (snap.empty) return;
    const batch = this.db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

export function hasFirebaseConfig() {
  return !!(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_CLIENT_EMAIL || process.env.FIRESTORE_EMULATOR_HOST);
}

export function createFirestoreStore() {
  const sa = credentials();
  const app =
    getApps()[0] ||
    initializeApp(sa ? { credential: cert(sa), projectId: sa.projectId || sa.project_id } : { projectId: process.env.FIREBASE_PROJECT_ID || "demo-rtec" });
  const db = getFirestore(app);
  if (!globalThis.__rtecFirestoreConfigured) {
    db.settings({ ignoreUndefinedProperties: true });
    globalThis.__rtecFirestoreConfigured = true;
  }
  const config = db.collection("config").doc("secrets");

  return {
    kind: "firestore",
    admins: new FirestoreCollection(db, "admins", ["username"]),
    clients: new FirestoreCollection(db, "clients", ["username", "token"]),
    playlists: new FirestoreCollection(db, "playlists"),
    devices: new FirestoreCollection(db, "devices", ["mac"]),
    pending: new FirestoreCollection(db, "pending_devices"),
    async getOrCreateSecret(generate) {
      return db.runTransaction(async (t) => {
        const snap = await t.get(config);
        if (snap.exists && snap.data().jwt) return snap.data().jwt;
        const jwt = generate();
        t.set(config, { jwt }, { merge: true });
        return jwt;
      });
    },
  };
}

