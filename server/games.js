// Jogos do dia: a agenda (jogos de hoje e dos proximos dias, com o canal que transmite no Brasil) e montada
// aqui no servidor, a partir do placar publico da ESPN, e guardada por alguns minutos (memoria + banco).
// O aparelho do cliente so recebe a lista pronta, ja cruzada com os canais da lista dele (matchGames).

// GAMES_API_URL: troca a fonte (usado nos testes com um placar simulado).
const espnBase = () => process.env.GAMES_API_URL || "https://site.api.espn.com/apis/site/v2/sports";
const UA = "RTecPlayer/1.0 (agenda de jogos)";
const TZ = "America/Sao_Paulo";
export const DAYS_AHEAD = 3; // hoje + 3 dias
const FRESH_MS = 30 * 60_000; // agenda sem jogo ao vivo: busca de novo a cada 30 min
const FRESH_LIVE_MS = 5 * 60_000; // com jogo rolando: a cada 5 min (placar)

/**
 * Campeonatos buscados. "tv": onde costuma passar no Brasil, usado so quando a ESPN nao informa o canal do
 * jogo (aparece como "provavel" para o cliente). Direitos mudam: confira a cada temporada.
 */
export const LEAGUES = [
  { id: "soccer/bra.1", name: "Brasileirão Série A", tv: ["Premiere", "Globo", "SporTV", "Record", "Prime Video", "CazéTV"] },
  { id: "soccer/bra.2", name: "Brasileirão Série B", tv: ["ESPN", "Disney+", "Band"] },
  { id: "soccer/bra.3", name: "Brasileirão Série C", tv: [] },
  { id: "soccer/bra.copa_do_brazil", name: "Copa do Brasil", tv: ["Globo", "SporTV", "Premiere", "Prime Video"] },
  { id: "soccer/bra.camp.paulista", name: "Paulistão", tv: [] },
  { id: "soccer/bra.camp.carioca", name: "Carioca", tv: [] },
  { id: "soccer/conmebol.libertadores", name: "Libertadores", tv: ["Globo", "ESPN", "Paramount+"] },
  { id: "soccer/conmebol.sudamericana", name: "Sul-Americana", tv: ["ESPN", "Paramount+"] },
  { id: "soccer/uefa.champions", name: "Champions League", tv: ["TNT Sports", "Max", "SBT"] },
  { id: "soccer/uefa.europa", name: "Europa League", tv: [] },
  { id: "soccer/eng.1", name: "Premier League", tv: ["ESPN", "Disney+"] },
  { id: "soccer/esp.1", name: "LaLiga", tv: ["ESPN", "Disney+"] },
  { id: "soccer/ita.1", name: "Série A Italiana", tv: ["ESPN", "Disney+"] },
  { id: "soccer/ger.1", name: "Bundesliga", tv: [] },
  { id: "soccer/fra.1", name: "Ligue 1", tv: [] },
  { id: "soccer/por.1", name: "Liga Portugal", tv: [] },
  { id: "soccer/arg.1", name: "Argentino", tv: [] },
  { id: "soccer/fifa.friendly", name: "Amistosos", tv: [] },
  { id: "basketball/nba", name: "NBA", tv: [] },
];

// ---------- Datas no horario de Brasilia ----------
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** "2026-10-27" no horario de Brasilia. */
export const brDay = (d) => dayFmt.format(d);
const ymd = (d) => brDay(d).replace(/-/g, "");

// ---------- Leitura do placar da ESPN ----------
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** Nomes de canais/plataformas do jogo no Brasil, sem repetir. */
function broadcastNames(comp) {
  const names = [];
  const add = (n) => {
    const s = str(n);
    if (s && !names.some((x) => x.toLowerCase() === s.toLowerCase())) names.push(s);
  };
  for (const g of comp.geoBroadcasts || []) add(g?.media?.shortName || g?.media?.name);
  for (const b of comp.broadcasts || []) for (const n of b?.names || []) add(n);
  return names.slice(0, 8);
}

function team(c) {
  const t = c?.team || c?.athlete || {};
  return {
    name: str(t.shortDisplayName) || str(t.displayName) || str(t.name) || "?",
    logo: str(t.logo) || str(t.logos?.[0]?.href),
    score: c?.score != null && c.score !== "" ? String(c.score?.displayValue ?? c.score) : "",
  };
}

/** Converte um evento da ESPN no formato da agenda. null: evento sem data ou sem times. */
export function parseEvent(ev, league) {
  const comp = ev?.competitions?.[0];
  const start = Date.parse(ev?.date || comp?.date || "");
  if (!comp || !Number.isFinite(start)) return null;
  const teams = comp.competitors || [];
  const home = teams.find((x) => x.homeAway === "home") || teams[0];
  const away = teams.find((x) => x.homeAway === "away") || teams[1];
  if (!home || !away) return null;
  const st = ev.status?.type || comp.status?.type || {};
  const state = ["pre", "in", "post"].includes(st.state) ? st.state : "pre";
  const found = broadcastNames(comp);
  return {
    id: `${league.id.split("/")[1]}:${ev.id}`,
    start: new Date(start).toISOString(),
    league: league.name,
    home: team(home),
    away: team(away),
    state,
    detail: state === "in" ? str(st.shortDetail) || str(ev.status?.displayClock) : "",
    broadcasts: found.length ? found : league.tv,
    guessed: !found.length && league.tv.length > 0,
  };
}

// A ESPN recusa intervalo de datas e o parametro limit: busca dia por dia (hoje e os proximos).
async function fetchLeague(league, from, to) {
  const days = [];
  for (let t = from.getTime(); brDay(new Date(t)) <= brDay(to); t += 24 * 3600_000) days.push(ymd(new Date(t)));
  const lists = await Promise.all(
    days.map(async (day) => {
      const q = new URLSearchParams({ dates: day, lang: "pt", region: "br" });
      const res = await fetch(`${espnBase()}/${league.id}/scoreboard?${q}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json", "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (data.events || []).map((ev) => parseEvent(ev, league)).filter(Boolean);
    }),
  );
  return lists.flat();
}

/** Busca todos os campeonatos e devolve so os jogos de hoje em diante (ate DAYS_AHEAD dias), em ordem. */
export async function buildAgenda(now = new Date(), fetcher = fetchLeague) {
  const from = new Date(now.getTime() - 2 * 3600_000); // a ESPN agrupa pelo dia nos EUA (1 a 2 h atras de Brasilia)
  const to = new Date(now.getTime() + DAYS_AHEAD * 24 * 3600_000);
  const today = brDay(now);
  const last = brDay(to);
  const results = await Promise.allSettled(LEAGUES.map((l) => fetcher(l, from, to)));
  const games = [];
  const seen = new Set();
  let failed = 0;
  let reason = "";
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failed++;
      reason ||= r.reason?.message || String(r.reason);
      console.warn(`[rtec] Jogos: ${LEAGUES[i].id} falhou: ${r.reason?.message || r.reason}`);
      return;
    }
    for (const g of r.value) {
      const day = brDay(new Date(g.start));
      // Jogo encerrado sai da lista; o que esta rolando fica mesmo que tenha comecado ontem.
      if (seen.has(g.id) || g.state === "post" || day > last || (day < today && g.state !== "in")) continue;
      seen.add(g.id);
      games.push(g);
    }
  });
  if (failed === LEAGUES.length) throw new Error(`Nenhum campeonato respondeu (${reason})`);
  games.sort((a, b) => a.start.localeCompare(b.start) || a.league.localeCompare(b.league));
  return { updated_at: now.toISOString(), games };
}

// ---------- Cache: memoria da funcao + banco (sobrevive a funcao fria da Vercel) ----------
let mem = null;
let running = null;
const isFresh = (a, now) => {
  if (!a?.updated_at) return false;
  const age = now - Date.parse(a.updated_at);
  const live = a.games.some((g) => g.state === "in" || (Date.parse(g.start) <= now && Date.parse(g.start) > now - 3 * 3600_000));
  return age < (live ? FRESH_LIVE_MS : FRESH_MS) && brDay(new Date(a.updated_at)) === brDay(new Date(now));
};

/** Agenda pronta. Busca de novo so quando ficou velha; se a busca falhar, usa a ultima que deu certo. */
export async function getAgenda(db, { now = Date.now(), build = buildAgenda } = {}) {
  if (isFresh(mem, now)) return mem;
  if (!mem && db) {
    const saved = await db.config.get("games_agenda").catch(() => null);
    if (saved?.games) mem = { updated_at: saved.updated_at, games: saved.games };
    if (isFresh(mem, now)) return mem;
  }
  if (!running) {
    running = build(new Date(now))
      .then(async (a) => {
        mem = a;
        if (db) await db.config.set("games_agenda", a).catch((err) => console.warn(`[rtec] Jogos: nao salvou no banco: ${err.message}`));
        return a;
      })
      .finally(() => {
        running = null;
      });
  }
  try {
    return await running;
  } catch (err) {
    if (mem) return mem;
    throw err;
  }
}
export const resetAgendaCache = () => {
  mem = null;
  running = null;
};

// ---------- Cruzamento com os canais da lista do cliente ----------
const NOISE = new Set(["fhd", "hd", "sd", "uhd", "fullhd", "hevc", "fps", "alt", "alternativo", "backup", "sinal", "opcao", "op", "br", "bra", "ao", "vivo", "tv", "canal", "ppv"]);
// Palavras que fazem ser outro canal: "Globo News" nao e a Globo, "Band Sports" nao e a Band.
const OTHER = new Set(["news", "sports", "sport", "esporte", "esportes", "kids", "junior", "jr", "channel", "play", "plus", "series", "filmes", "movies", "cinema", "music", "hits", "pop", "life", "comedy", "action", "premium", "extra", "fight", "combate", "mundo", "radio", "fm", "4u", "xd", "off", "women", "mulher", "kombat"]);
// Nome do canal na agenda -> nomes como costumam aparecer nas listas.
const ALIASES = {
  tnt: ["tnt sports"],
  max: ["max", "hbo max"],
  "hbo max": ["hbo max", "max"],
  premiere: ["premiere", "premiere clubes"],
  "premiere fc": ["premiere", "premiere clubes"],
  "prime video": ["prime video", "amazon prime video", "amazon prime"],
  "amazon prime video": ["prime video", "amazon prime video", "amazon prime"],
  "espn brasil": ["espn brasil", "espn"],
  globoplay: ["globo"],
  "star plus": ["star plus", "disney plus"],
  youtube: [],
};

const SUP = { "¹": "1", "²": "2", "³": "3", "⁴": "4" };
/** Nome de canal em palavras normalizadas: "BR: SporTV² FHD [Alt]" -> ["sportv", "2"]. */
export function channelWords(name) {
  let s = String(name || "")
    .replace(/[¹²³⁴]/g, (c) => ` ${SUP[c]}`)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    .replace(/^\s*[a-z]{2,3}\s*[:|]\s*/, " ")
    .replace(/\+/g, " plus ")
    .replace(/caze\s*tv/g, "cazetv")
    .replace(/\b(\d{3,4}p|\d+\s*fps|h\.?26[45]|[248]k)\b/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  return s
    .split(" ")
    .filter((w) => w && !NOISE.has(w))
    .map((w) => (/^\d+$/.test(w) ? String(Number(w)) : w));
}

/**
 * 2: mesmo canal ("Globo SP" para "Globo"); 1: o mesmo com numero ("Premiere 3" para "Premiere"),
 * so usado quando nao ha nenhum 2; 0: outro canal.
 */
function matchLevel(bw, cw) {
  if (!bw.length || cw.length < bw.length) return 0;
  if (cw.join("") === bw.join("")) return 2;
  for (let i = 0; i < bw.length; i++) if (cw[i] !== bw[i]) return 0;
  const extra = cw.slice(bw.length);
  if (extra.some((w) => OTHER.has(w))) return 0;
  const numbers = extra.filter((w) => /^\d+$/.test(w));
  if (!numbers.length) return 2;
  // Agenda ja diz o numero ("SporTV 2"): "SporTV 2 3" nao serve. Sem numero na agenda: aceita "Premiere 4".
  return numbers.length === 1 && !bw.some((w) => /^\d+$/.test(w)) ? 1 : 0;
}

const MAX_PER_BROADCAST = 6;

/**
 * Cruza a agenda com os canais do cliente (itens com { name }). Devolve os jogos com "channels": os canais
 * da lista que passam o jogo (mais parecidos primeiro). toChannel converte o item no formato do reprodutor.
 */
export function matchGames(games, items, toChannel = (it) => it) {
  const byFirst = new Map();
  for (const it of items) {
    const cw = channelWords(it.name);
    if (!cw.length) continue;
    const k = cw[0][0];
    (byFirst.get(k) || byFirst.set(k, []).get(k)).push({ it, cw });
  }
  const cache = new Map();
  const find = (broadcast) => {
    const key = channelWords(broadcast).join(" ");
    if (cache.has(key)) return cache.get(key);
    const names = ALIASES[key] ?? [key];
    let best = [];
    let level = 0;
    for (const n of names) {
      const bw = n.split(" ").filter(Boolean);
      if (!bw.length) continue;
      for (const e of byFirst.get(bw[0][0]) || []) {
        const l = matchLevel(bw, e.cw);
        if (!l || l < level) continue;
        if (l > level) {
          level = l;
          best = [];
        }
        best.push(e);
      }
    }
    // Mais curto primeiro ("Globo" antes de "Globo Nordeste"), depois pelo numero ("Premiere 2" antes do 10).
    const num = (cw) => Number(cw.find((w) => /^\d+$/.test(w)) || 0);
    best.sort((a, b) => a.cw.length - b.cw.length || num(a.cw) - num(b.cw) || a.it.name.localeCompare(b.it.name));
    const out = best.slice(0, MAX_PER_BROADCAST).map((e) => e.it);
    cache.set(key, out);
    return out;
  };
  return games.map((g) => {
    const used = new Set();
    const channels = [];
    for (const b of g.broadcasts) {
      for (const it of find(b)) {
        if (used.has(it)) continue;
        used.add(it);
        channels.push({ broadcast: b, item: it });
      }
    }
    return { ...g, channels: channels.map((x) => ({ ...toChannel(x.item), broadcast: x.broadcast })) };
  });
}
