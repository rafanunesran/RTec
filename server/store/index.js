import { createFirestoreStore, hasFirebaseConfig } from "./firestore.js";
import { createMemoryStore } from "./memory.js";
import { sealCollection } from "../seal.js";

export { DuplicateError } from "./errors.js";

let store;

/** Links, usuarios e senhas do fornecedor ficam cifrados no banco (quando DATA_KEY esta configurada). */
const sealed = (s) => ({ ...s, clients: sealCollection("clients", s.clients), playlists: sealCollection("playlists", s.playlists) });

/** Firestore quando ha credenciais do Firebase; senao, banco em memoria (so para testes/desenvolvimento). */
export function getStore() {
  if (store) return store;
  if (hasFirebaseConfig()) {
    store = sealed(createFirestoreStore());
  } else {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new Error("Firebase nao configurado: defina FIREBASE_SERVICE_ACCOUNT nas variaveis de ambiente.");
    }
    console.warn("[rtec] Sem credenciais do Firebase: usando banco em memoria (os dados somem ao reiniciar).");
    store = sealed(createMemoryStore());
  }
  return store;
}

export function setStore(s) {
  store = s && sealed(s);
}
