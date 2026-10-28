import { api, type Channel } from "@/lib/api";

// Links que passam pelo servidor de video expiram em 12 h. O que fica guardado no aparelho
// (historico, favoritos, "continuar assistindo") precisa ser renovado antes de tocar.
const PROXY = /\/api\/player\/proxy\?/;
const FIELDS = ["src", "alt", "fallback", "logo", "cover"] as const;

function expiresSoon(url: string) {
  if (!PROXY.test(url)) return false;
  try {
    const e = Number(new URL(url, location.origin).searchParams.get("e"));
    return !e || e * 1000 < Date.now() + 3600_000;
  } catch {
    return false;
  }
}

/** Devolve os canais com os links do servidor de video renovados (os que ja venceram ou vencem em 1 h). */
export async function refreshChannels(list: Channel[]): Promise<Channel[]> {
  const need: string[] = [];
  for (const c of list) {
    // Inclui as reservas de outras listas do cliente ("more").
    for (const v of [...FIELDS.map((f) => c[f]), ...(c.more || []).flatMap((m) => [m.src, m.alt, m.fallback])]) {
      if (v && expiresSoon(v) && !need.includes(v)) need.push(v);
    }
  }
  if (!need.length) return list;
  const fresh = new Map<string, string>();
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    const res = await api.post<{ urls: string[] }>("/api/player/resign", { urls: chunk });
    chunk.forEach((u, j) => res.urls[j] && fresh.set(u, res.urls[j]));
  }
  return list.map((c) => {
    const n: Channel = { ...c };
    for (const f of FIELDS) {
      const v = c[f];
      if (v && fresh.has(v)) n[f] = fresh.get(v)!;
    }
    const renew = (v?: string) => (v && fresh.get(v)) || v || "";
    if (c.more) n.more = c.more.map((m) => ({ ...m, src: renew(m.src), alt: renew(m.alt), fallback: renew(m.fallback) }));
    return n;
  });
}
