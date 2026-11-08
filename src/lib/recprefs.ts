import { scoped } from "./profiles";

// Recomendacoes de Filmes e Series: generos escolhidos pela pessoa na primeira vez que abre a secao.
// Guardado no aparelho por perfil; "done" evita perguntar de novo (mesmo se ela pulou).

export type RecKind = "movie" | "series";
export type RecPrefs = { genres: string[]; done: boolean };
const KEY = "rtec:rec-prefs";

function readAll(): Partial<Record<RecKind, RecPrefs>> {
  try {
    const v = localStorage.getItem(scoped(KEY));
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}

export const loadRecPrefs = (kind: RecKind): RecPrefs => ({ genres: [], done: false, ...readAll()[kind] });

export function saveRecPrefs(kind: RecKind, p: RecPrefs) {
  try {
    localStorage.setItem(scoped(KEY), JSON.stringify({ ...readAll(), [kind]: p }));
  } catch {
    /* armazenamento indisponivel */
  }
}
