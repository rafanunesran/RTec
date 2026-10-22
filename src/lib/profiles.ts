import { api } from "@/lib/api";

// Perfis da conta (como na Netflix): cada um com seus favoritos, historico e progresso.
// O perfil "main" usa as chaves antigas do aparelho, entao o que ja estava salvo vira dele.
export type Viewer = { id: string; name: string; avatar: number; kids: boolean };
export type ProfilesResponse = { profiles: Viewer[]; max: number };

export const MAIN_PROFILE = "main";
const LAST = "rtec:profile"; // { user, id }: ultimo perfil usado neste aparelho
const CACHE = "rtec:profiles"; // { user, profiles }: para abrir sem rede

let current = MAIN_PROFILE;

/** Perfil cujos dados estao sendo lidos/gravados no aparelho. */
export const currentProfile = () => current;

export function setStorageProfile(id: string) {
  current = id;
}

/** Chave do localStorage do perfil atual (o principal fica com a chave antiga). */
export function scoped(key: string, id = current) {
  return id === MAIN_PROFILE ? key : `${key}:${id}`;
}

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponivel */
  }
}

export function lastProfile(user: string) {
  const v = read<{ user: string; id: string }>(LAST);
  return v?.user === user ? v.id : null;
}

export function rememberProfile(user: string, id: string) {
  write(LAST, { user, id });
}

/** Lista de perfis da conta; sem rede, usa a ultima que veio para este aparelho. */
export async function fetchProfiles(user: string): Promise<ProfilesResponse> {
  try {
    const res = await api.get<ProfilesResponse>("/api/player/profiles");
    write(CACHE, { user, ...res });
    return res;
  } catch (err) {
    const cached = read<ProfilesResponse & { user: string }>(CACHE);
    if (cached?.user === user && cached.profiles?.length) return { profiles: cached.profiles, max: cached.max };
    throw err;
  }
}

/** Apaga do aparelho os dados de um perfil excluido. */
export function forgetProfile(id: string) {
  if (id === MAIN_PROFILE) return;
  for (const k of ["rtec:favs", "rtec:history", "rtec:progress", "rtec:sync", "rtec:linksig"]) {
    try {
      localStorage.removeItem(scoped(k, id));
    } catch {
      /* armazenamento indisponivel */
    }
  }
}
