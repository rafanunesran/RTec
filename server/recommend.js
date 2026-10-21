// Recomendacoes de titulos semelhantes dentro do catalogo do proprio fornecedor.
// Pontua cada filme/serie comparando com o titulo aberto: genero, direcao, elenco, ano, nota,
// categoria e nome (continuacoes da mesma franquia). Funcoes puras, testadas em app.test.js.

import { cleanTitle } from "./titleinfo.js";

const fold = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Generos em ingles (TMDB/fornecedor) e variacoes -> nome unico em portugues sem acento.
const GENRE_ALIASES = {
  action: "acao",
  adventure: "aventura",
  animation: "animacao",
  animacoes: "animacao",
  anime: "animacao",
  desenho: "animacao",
  desenhos: "animacao",
  infantil: "familia",
  infantis: "familia",
  kids: "familia",
  family: "familia",
  comedy: "comedia",
  comedias: "comedia",
  crime: "crime",
  policial: "crime",
  documentary: "documentario",
  documentarios: "documentario",
  drama: "drama",
  dramas: "drama",
  fantasy: "fantasia",
  history: "historia",
  historico: "historia",
  horror: "terror",
  music: "musica",
  musical: "musica",
  mystery: "misterio",
  romance: "romance",
  romantico: "romance",
  "science fiction": "ficcao cientifica",
  "sci-fi": "ficcao cientifica",
  scifi: "ficcao cientifica",
  "ficcao": "ficcao cientifica",
  thriller: "suspense",
  war: "guerra",
  western: "faroeste",
  "action & adventure": "acao",
  "sci-fi & fantasy": "ficcao cientifica",
  "war & politics": "guerra",
  reality: "reality",
  "reality show": "reality",
  "tv movie": "cinema tv",
  nacional: "nacional",
  nacionais: "nacional",
};

/** "Ação" / "Action" / "Acao" -> "acao" */
export function normGenre(g) {
  const f = fold(g).replace(/\s+/g, " ");
  return GENRE_ALIASES[f] || f;
}

/** Generos ditos no nome da categoria: "FILMES | ACAO E AVENTURA" -> ["acao", "aventura"] */
export function genresInText(text) {
  const words = fold(text).replace(/[^a-z0-9& -]+/g, " ");
  const found = new Set();
  for (const [alias, g] of Object.entries(GENRE_ALIASES)) {
    if (new RegExp(`(^|[^a-z])${alias.replace(/[&-]/g, "\\$&")}([^a-z]|$)`).test(words)) found.add(g);
  }
  for (const g of new Set(Object.values(GENRE_ALIASES))) {
    if (new RegExp(`(^|[^a-z])${g}([^a-z]|$)`).test(words)) found.add(g);
  }
  // "Ficcao" sozinha ja virou ficcao cientifica; "cientifica" nao e genero.
  return [...found];
}

const STOP = new Set("a o as os e de da do das dos em no na nos nas um uma the of and to in on parte part vol volume capitulo chapter temporada season filme movie serie".split(" "));

/** Palavras que identificam a franquia: "Velozes e Furiosos 7" -> ["velozes", "furiosos"] */
export function titleWords(name) {
  return fold(cleanTitle(name))
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w) && !/^[ivx]+$/.test(w));
}

/** Nome sem versao/qualidade, para juntar "Duna [4K]" e "Duna - Legendado". */
export const sameTitleKey = (name) =>
  fold(cleanTitle(name))
    .replace(/\b(19|20)\d{2}\s*$/, "")
    .replace(/[^a-z0-9]+/g, "");

const people = (list) => new Set((list || []).map(fold).filter(Boolean));
const genreSet = (list) => new Set((list || []).map(normGenre).filter(Boolean));

/**
 * Nota de semelhanca entre o titulo aberto (target) e um candidato.
 * target/cand: { name, genres, director, cast, year, rating, category } (campos podem faltar).
 * Devolve { score, reasons } com os motivos mais fortes primeiro.
 */
export function similarity(target, cand) {
  let score = 0;
  const reasons = [];

  // Franquia / continuacao: muitas palavras do nome em comum.
  const tw = new Set(titleWords(target.name));
  const cw = titleWords(cand.name);
  if (tw.size && cw.length) {
    const shared = cw.filter((w) => tw.has(w)).length;
    const ratio = shared / Math.min(tw.size, new Set(cw).size);
    if (shared && ratio >= 0.5) {
      score += 3 * ratio;
      if (ratio >= 0.99) reasons.push({ w: 10, text: "Da mesma franquia" });
    }
  }

  // Genero: proporcao dos generos do titulo aberto que o candidato tambem tem.
  const tg = genreSet(target.genres);
  const cg = genreSet(cand.genres);
  const catGenres = new Set(genresInText(cand.category));
  if (tg.size) {
    const known = cg.size ? cg : catGenres; // sem ficha, o nome da categoria indica o genero
    const shared = [...tg].filter((g) => known.has(g));
    if (shared.length) {
      const w = (cg.size ? 4 : 2.5) * (shared.length / tg.size) + (shared.length > 1 ? 0.5 : 0);
      score += w;
      const label = (cand.genres || []).find((g) => shared.includes(normGenre(g))) || (target.genres || []).find((g) => shared.includes(normGenre(g)));
      if (label) reasons.push({ w: w - 1, text: label });
    } else if (cg.size) score -= 1; // generos conhecidos e nenhum em comum: provavelmente outro estilo
  }
  if (target.category && cand.category && fold(target.category) === fold(cand.category)) score += 1;

  // Direcao (ou criacao, nas series): o sinal mais forte de estilo.
  const td = people(target.director);
  const sharedDir = (cand.director || []).filter((p) => td.has(fold(p)));
  if (sharedDir.length) {
    const w = Math.min(5, 3.5 * sharedDir.length);
    score += w;
    reasons.push({ w: w + 1, text: `Direção de ${sharedDir[0]}` });
  }

  // Elenco: os primeiros nomes do elenco do titulo aberto valem mais (protagonistas).
  const tc = (target.cast || []).map(fold);
  const sharedCast = (cand.cast || []).filter((p) => tc.includes(fold(p)));
  if (sharedCast.length) {
    let w = 0;
    for (const p of sharedCast) w += tc.indexOf(fold(p)) < 4 ? 1.6 : 0.9;
    w = Math.min(4.5, w);
    score += w;
    reasons.push({ w, text: sharedCast.length > 1 ? `Com ${sharedCast[0]} e ${sharedCast[1]}` : `Com ${sharedCast[0]}` });
  }

  // Ano: quanto mais perto da mesma epoca, melhor.
  if (target.year && cand.year) {
    const dy = Math.abs(target.year - cand.year);
    score += 1.5 * Math.max(0, 1 - dy / 15);
  }

  // Nota do publico: desempata a favor dos mais bem avaliados.
  if (cand.rating) {
    score += Math.max(-1, Math.min(1.2, (cand.rating - 6) / 3));
    if (cand.rating >= 8) reasons.push({ w: 0.5, text: `Nota ${cand.rating.toFixed(1)}` });
  }

  return { score: Math.round(score * 100) / 100, reasons: reasons.sort((a, b) => b.w - a.w).map((r) => r.text) };
}

/**
 * Ordena os candidatos pela semelhanca, sem o proprio titulo e sem versoes repetidas do mesmo nome.
 * Cada candidato precisa de um `id` unico; devolve [{ ...cand, score, reasons }].
 */
export function rankSimilar(target, candidates, { limit = 20, minScore = 1.5 } = {}) {
  const own = sameTitleKey(target.name);
  const best = new Map();
  for (const cand of candidates) {
    if ((target.id && cand.id === target.id) || !cand.name) continue;
    const key = sameTitleKey(cand.name);
    if (!key || key === own) continue;
    const { score, reasons } = similarity(target, cand);
    if (score < minScore) continue;
    const prev = best.get(key);
    if (!prev || score > prev.score) best.set(key, { ...cand, score, reasons });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || (b.rating || 0) - (a.rating || 0)).slice(0, limit);
}
