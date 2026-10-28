// Alertas de novos episodios: o servidor guarda, por perfil, quantos episodios cada serie tinha
// quando o cliente viu e, de tempos em tempos, confere de novo no fornecedor (so as series com alerta).
// Series favoritas entram sozinhas; o sino da serie liga ou desliga (vale mais que o favorito).

export const MAX_ALERTS = 60;
export const CHECK_EVERY_MS = 3 * 3600_000; // confere no fornecedor no maximo a cada 3 h por perfil
const CHECK_PARALLEL = 4;
const CHECK_BUDGET_MS = 20_000;

const TOP = 10_000;
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

/** Contagem e ultimo episodio (temporada * 10000 + episodio) de uma lista de episodios. */
export function snapshot(episodes) {
  let top = 0;
  for (const ep of episodes) top = Math.max(top, (Number(ep.season) || 1) * TOP + (Number(ep.episode) || 0));
  return { count: episodes.length, top };
}

const cleanSnap = (s) => (s && Number.isFinite(s.count) && Number.isFinite(s.top) ? { count: Math.max(0, Math.round(s.count)), top: Math.max(0, Math.round(s.top)) } : null);
export const readSnap = (body) => cleanSnap({ count: Number(body?.count), top: Number(body?.top) });

/** Serie que vem do aparelho (id do card da serie: "s<id>" no Xtream, "serie:<nome>" nas listas M3U). */
export function cleanSeries(b) {
  const id = text(b?.id, 300);
  if (!/^(s.|serie:.)/.test(id)) return null;
  return { id, name: text(b.name, 200), logo: text(b.logo, 2000), series_id: text(b.series_id, 80) };
}

const isSeriesFav = (f) => f && f.kind === "series" && typeof f.id === "string" && (!!f.series_id || f.id.startsWith("serie:"));

/** Series com alerta ligado: as marcadas no sino e as favoritas (menos as desligadas no sino). */
export function alertTargets(doc, favorites) {
  const entries = doc.series || {};
  const out = new Map();
  for (const f of favorites || []) {
    if (!isSeriesFav(f) || entries[f.id]?.on === false) continue;
    out.set(f.id, { id: f.id, name: f.name || "", logo: f.logo || "", series_id: f.series_id || "", fav: true });
  }
  for (const [id, e] of Object.entries(entries)) {
    if (e.on === true && !out.has(id)) out.set(id, { id, name: e.name || "", logo: e.logo || "", series_id: e.series_id || "", fav: false });
  }
  return [...out.values()].slice(0, MAX_ALERTS);
}

/** Quantos episodios novos desde o que o cliente viu (0 se nada mudou ou ainda nao ha comparacao). */
export function newCount(base, cur) {
  if (!base || !cur) return 0;
  if (cur.count > base.count) return cur.count - base.count;
  return cur.top > base.top ? 1 : 0;
}

/** Guarda o que o cliente viu agora (abriu a serie ou ligou o alerta). */
export function markSeen(doc, s, snap, now = Date.now()) {
  doc.series = doc.series || {};
  const e = doc.series[s.id] || {};
  doc.series[s.id] = { ...e, name: s.name || e.name || "", logo: s.logo || e.logo || "", series_id: s.series_id || e.series_id || "", base: snap, cur: snap, t: now };
}

/** Liga (true), desliga (false) ou volta a seguir o favorito (null). */
export function setAlert(doc, s, on, snap, now = Date.now()) {
  doc.series = doc.series || {};
  const e = { ...(doc.series[s.id] || {}), name: s.name, logo: s.logo, series_id: s.series_id };
  if (on === null) delete e.on;
  else e.on = on;
  if (snap) Object.assign(e, { base: snap, cur: snap, t: now });
  doc.series[s.id] = e;
  // Limite de series guardadas: saem as mexidas ha mais tempo.
  const ids = Object.keys(doc.series);
  if (ids.length > MAX_ALERTS * 3) {
    ids.sort((a, b) => (doc.series[a].t || 0) - (doc.series[b].t || 0));
    for (const id of ids.slice(0, ids.length - MAX_ALERTS * 3)) delete doc.series[id];
  }
}

/**
 * Confere no fornecedor as series com alerta (episodes(target) devolve os episodios).
 * Serie sem comparacao guardada so ganha a de agora (nao avisa na primeira vez).
 */
export async function checkAlerts(doc, targets, episodes, { now = Date.now(), budgetMs = CHECK_BUDGET_MS } = {}) {
  doc.series = doc.series || {};
  const deadline = now + budgetMs;
  const queue = targets.filter((t) => t.series_id);
  const worker = async () => {
    while (queue.length && Date.now() < deadline) {
      const t = queue.shift();
      let snap;
      try {
        snap = snapshot(await episodes(t));
      } catch {
        continue; // fornecedor falhou nesta serie: fica a ultima conferida
      }
      if (!snap.count) continue; // lista vazia costuma ser erro do fornecedor, nao serie sem episodios
      const e = doc.series[t.id] || { name: t.name, logo: t.logo, series_id: t.series_id };
      doc.series[t.id] = { ...e, base: e.base || snap, cur: snap, t: e.t || now };
    }
  };
  await Promise.all(Array.from({ length: CHECK_PARALLEL }, worker));
  doc.checked_at = now;
}

/** O que o aparelho recebe: cada serie com alerta e quantos episodios novos ela tem. */
export function alertList(doc, targets) {
  return targets.map((t) => {
    const e = doc.series?.[t.id] || {};
    const n = newCount(e.base, e.cur);
    const top = e.cur?.top || 0;
    return { ...t, name: t.name || e.name || "", logo: t.logo || e.logo || "", base: e.base || null, new: n, season: n ? Math.floor(top / TOP) : 0, episode: n ? top % TOP : 0 };
  });
}
