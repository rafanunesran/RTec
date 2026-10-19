import { createFirestoreStore, hasFirebaseConfig } from "./firestore.js";
import { createMemoryStore } from "./memory.js";

export { DuplicateError } from "./errors.js";

let store;

/** Firestore quando ha credenciais do Firebase; senao, banco em memoria (so para testes/desenvolvimento). */
export function getStore() {
  if (store) return store;
  if (hasFirebaseConfig()) {
    store = createFirestoreStore();
  } else {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new Error("Firebase nao configurado: defina FIREBASE_SERVICE_ACCOUNT nas variaveis de ambiente.");
    }
    console.warn("[rtec] Sem credenciais do Firebase: usando banco em memoria (os dados somem ao reiniciar).");
    store = createMemoryStore();
  }
  return store;
}

export function setStore(s) {
  store = s;
}
