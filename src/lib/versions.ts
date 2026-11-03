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

/** Versao pelas marcas do nome (mesma regra do servidor): "Filme [L] 4K" -> "L|4K". */
export function tagOfName(name: string): string {
  const n = name || "";
  const lang = /\[L\]|\(L\)|\blegendad|\bleg\b/i.test(n) ? "L" : "";
  const q = /[([]\s*(cinema|hdcam|cam|ts)\s*[)\]]/i.test(n)
    ? "CINEMA"
    : /\b(4k|uhd|2160p)\b/i.test(n)
      ? "4K"
      : /\b(fhd|1080p)\b/i.test(n)
        ? "FHD"
        : /\b(hd|720p)\b/i.test(n)
          ? "HD"
          : /\bsd\b/i.test(n)
            ? "SD"
            : "";
  return `${lang}|${q}`;
}

const QUALITY: Record<string, string> = { CINEMA: "Cinema", "": "Normal" };

/** Nome da versao entre as do titulo: so o que muda entre elas ("Legendado · 4K"); sozinha, o que o nome diz. */
export function tagLabel(tag: string, all: string[]): string {
  const t = parse(tag);
  const many = all.length > 1;
  const langs = new Set(all.map((x) => parse(x).lang)).size > 1;
  const quals = new Set(all.map((x) => parse(x).q)).size > 1;
  const parts: string[] = [];
  if (langs || (!many && t.lang)) parts.push(t.lang === "L" ? "Legendado" : "Dublado");
  if (quals || (!many && t.q)) parts.push(QUALITY[t.q] ?? t.q);
  return parts.join(" · ") || "Padrão";
}

/** Das versoes, a que combina com a preferencia (idioma pesa mais que a definicao; cinema so se escolhida). */
export function bestTag(tags: string[], current?: string): string {
  const pref = versionPref();
  let best = tags.includes(current ?? "\0") ? current! : tags[0];
  if (!pref) return best;
  const score = (tag: string) => {
    const t = parse(tag);
    const cinema = t.q === "CINEMA" && pref.q !== "CINEMA" ? -4 : 0;
    return (t.lang === pref.lang ? 2 : 0) + (t.q === pref.q ? 1 : 0) + cinema;
  };
  for (const tag of tags) if (score(tag) > score(best)) best = tag;
  return best;
}

/** Escolhe a versao que combina com a preferencia. Sem preferencia: a que veio. */
export function preferredVersion(c: Channel): Channel {
  if (!versionPref() || !c.versions?.length) return c;
  const tag = bestTag(
    c.versions.map((v) => v.tag),
    c.tag,
  );
  const best = c.versions.find((v) => v.tag === tag)!;
  return best.tag === c.tag ? c : withVersion(c, best);
}

/** Versoes que existem num titulo (filme) ou em qualquer episodio da serie, sem cinema na frente. */
export function versionTags(items: Channel[], fallbackName = ""): string[] {
  const tags = new Set<string>();
  for (const c of items) {
    if (c.versions?.length) c.versions.forEach((v) => tags.add(v.tag));
    else tags.add(c.tag || tagOfName(`${fallbackName} ${c.name}`));
  }
  return [...tags].sort((a, b) => Number(parse(a).q === "CINEMA") - Number(parse(b).q === "CINEMA"));
}

/** Titulo com uma versao so: ela mesma, com o nome tirado das marcas do titulo ("[L]", "4K", "(cinema)"). */
export function singleVersion(c: Channel): Version {
  const tag = c.tag || tagOfName(c.name);
  return { tag, label: tagLabel(tag, [tag]), src: c.src, type: c.type, alt: c.alt, alt_type: c.alt_type, fallback: c.fallback };
}
