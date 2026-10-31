import type { Channel, Version } from "@/lib/api";
import { scoped } from "@/lib/profiles";

// Versoes do mesmo titulo (dublado, legendado, 4K...): o catalogo mostra um item so e o reprodutor deixa trocar.
// A ultima escolha fica lembrada por perfil e vale para todos os titulos que tiverem essa versao.
const KEY = "rtec:version";

/** Preferencia: idioma ("L" legendado, "" dublado) e definicao ("4K", "FHD", "HD", "SD", "" normal). */
type Pref = { lang: string; q: string };

const parse = (tag: string) => {
  const [lang = "", q = ""] = tag.split("|");
  return { lang, q };
};

export function versionPref(): Pref | null {
  try {
    const v = JSON.parse(localStorage.getItem(scoped(KEY)) || "null");
    return v && typeof v.lang === "string" && typeof v.q === "string" ? v : null;
  } catch {
    return null;
  }
}

export function saveVersionPref(tag: string) {
  try {
    localStorage.setItem(scoped(KEY), JSON.stringify(parse(tag)));
  } catch {
    /* armazenamento indisponivel: vale so para este titulo */
  }
}

/** O titulo tocando na versao escolhida (links, reservas e tag dela). */
export function withVersion(c: Channel, v: Version): Channel {
  return { ...c, src: v.src, type: v.type, alt: v.alt, alt_type: v.alt_type, fallback: v.fallback, more: v.more, tag: v.tag };
}

/** Escolhe a versao que combina com a preferencia (idioma pesa mais que a definicao). Sem preferencia: a que veio. */
export function preferredVersion(c: Channel): Channel {
  const pref = versionPref();
  if (!pref || !c.versions?.length) return c;
  const score = (tag: string) => {
    const t = parse(tag);
    // Versao de cinema so quando foi a escolhida; se nao, perde para qualquer outra.
    const cinema = t.q === "CINEMA" && pref.q !== "CINEMA" ? -4 : 0;
    return (t.lang === pref.lang ? 2 : 0) + (t.q === pref.q ? 1 : 0) + cinema;
  };
  let best = c.versions.find((v) => v.tag === c.tag) || c.versions[0];
  for (const v of c.versions) if (score(v.tag) > score(best.tag)) best = v;
  return best.tag === c.tag ? c : withVersion(c, best);
}

/** Titulo com uma versao so: ela mesma, com o nome tirado das marcas do titulo ("[L]", "4K", "(cinema)"). */
export function singleVersion(c: Channel): Version {
  const n = c.name || "";
  const parts = [];
  if (/\[L\]|\(L\)|\blegendad|\bleg\b/i.test(n)) parts.push("Legendado");
  else if (/\bdublad|\bdub\b/i.test(n)) parts.push("Dublado");
  if (/[([]\s*(cinema|hdcam|cam|ts)\s*[)\]]/i.test(n)) parts.push("Cinema");
  else if (/\b(4k|uhd|2160p)\b/i.test(n)) parts.push("4K");
  else if (/\b(fhd|1080p)\b/i.test(n)) parts.push("FHD");
  return { tag: c.tag || "", label: parts.join(" · ") || "Padrão", src: c.src, type: c.type, alt: c.alt, alt_type: c.alt_type, fallback: c.fallback };
}
