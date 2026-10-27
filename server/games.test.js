import { test } from "node:test";
import assert from "node:assert/strict";
import { LEAGUES, brDay, buildAgenda, channelWords, getAgenda, matchGames, parseEvent, resetAgendaCache } from "./games.js";

const names = (g) => g.channels.map((c) => c.name);
const game = (broadcasts) => ({ id: "x", start: "2026-10-27T22:00:00.000Z", broadcasts });

test("nome do canal vira palavras sem qualidade, prefixo de pais ou sinal alternativo", () => {
  assert.deepEqual(channelWords("BR: SporTV² FHD [Alt]"), ["sportv", "2"]);
  assert.deepEqual(channelWords("SPORTV2 HD"), ["sportv", "2"]);
  assert.deepEqual(channelWords("Premiere 04 H265 60fps"), ["premiere", "4"]);
  assert.deepEqual(channelWords("Disney+ 1 4K"), ["disney", "plus", "1"]);
  assert.deepEqual(channelWords("TV Globo SP (Alternativo)"), ["globo", "sp"]);
  assert.deepEqual(channelWords("Cazé TV"), ["cazetv"]);
});

test("cruza o canal da agenda com os canais da lista do cliente", () => {
  const items = [
    "Globo SP FHD", "Globo RJ", "Globo News", "GloboNews", "Globoplay Novelas",
    "SporTV FHD", "SporTV 2", "SporTV 3",
    "Premiere Clubes", "Premiere 2", "Premiere 3",
    "ESPN", "ESPN 2", "ESPN 4", "Band SP", "Band Sports", "TNT Sports HD", "TNT Series",
    "Disney+ 01", "Disney Channel", "CazéTV",
  ].map((name) => ({ name }));
  const [g] = matchGames([game(["Globo", "SporTV 2"])], items);
  assert.deepEqual(names(g), ["Globo RJ", "Globo SP FHD", "SporTV 2"]);
  assert.equal(g.channels[2].broadcast, "SporTV 2");

  assert.deepEqual(names(matchGames([game(["Premiere"])], items)[0]), ["Premiere Clubes"]);
  assert.deepEqual(names(matchGames([game(["Band"])], items)[0]), ["Band SP"]);
  assert.deepEqual(names(matchGames([game(["TNT"])], items)[0]), ["TNT Sports HD"]);
  assert.deepEqual(names(matchGames([game(["Disney+"])], items)[0]), ["Disney+ 01"], "streaming: canais numerados da lista");
  assert.deepEqual(names(matchGames([game(["CazéTV"])], items)[0]), ["CazéTV"]);
  assert.deepEqual(names(matchGames([game(["ESPN"])], items)[0]), ["ESPN"], "com o canal exato, nao lista os numerados");
  assert.deepEqual(names(matchGames([game(["Record"])], items)[0]), []);

  // Sem "Premiere Clubes": os numerados servem
  const only = items.filter((i) => i.name !== "Premiere Clubes");
  assert.deepEqual(names(matchGames([game(["Premiere"])], only)[0]), ["Premiere 2", "Premiere 3"]);
});

test("evento da ESPN: canais do Brasil, ou os provaveis do campeonato quando nao vem nenhum", () => {
  const league = LEAGUES.find((l) => l.id === "soccer/bra.1");
  const ev = {
    id: "9",
    date: "2026-10-27T22:00Z",
    status: { type: { state: "in", shortDetail: "34'" } },
    competitions: [
      {
        competitors: [
          { homeAway: "away", score: "1", team: { displayName: "Palmeiras", logo: "https://a/p.png" } },
          { homeAway: "home", score: "0", team: { displayName: "Flamengo", logo: "https://a/f.png" } },
        ],
        geoBroadcasts: [{ media: { shortName: "Premiere" } }, { media: { shortName: "Globo" } }],
        broadcasts: [{ names: ["Globo", "Prime Video"] }],
      },
    ],
  };
  const g = parseEvent(ev, league);
  assert.equal(g.id, "bra.1:9");
  assert.equal(g.sport, "Futebol");
  assert.equal(g.league_id, "bra.1");
  assert.equal(g.home.name, "Flamengo");
  assert.equal(g.away.score, "1");
  assert.equal(g.state, "in");
  assert.equal(g.detail, "34'");
  assert.deepEqual(g.broadcasts, ["Premiere", "Globo", "Prime Video"]);
  assert.equal(g.guessed, false);

  delete ev.competitions[0].geoBroadcasts;
  delete ev.competitions[0].broadcasts;
  const guess = parseEvent(ev, league);
  assert.deepEqual(guess.broadcasts, league.tv);
  assert.equal(guess.guessed, true);
});

test("agenda: de hoje ate 3 dias, sem jogos encerrados, e guardada por alguns minutos", async () => {
  const now = new Date("2026-10-27T15:00:00Z"); // 12h em Brasilia
  const mk = (id, start, state = "pre") => ({ id, start, league: "X", home: {}, away: {}, state, broadcasts: [], guessed: false });
  const fetcher = async (league) => {
    if (league.id !== "soccer/bra.1") throw new Error("HTTP 404");
    return [
      mk("ontem", "2026-10-26T22:00:00.000Z"),
      mk("rolando", "2026-10-27T02:30:00.000Z", "in"), // 23h30 de ontem em Brasilia, ainda ao vivo
      mk("fim", "2026-10-27T14:00:00.000Z", "post"),
      mk("noite", "2026-10-28T00:30:00.000Z"), // 21h30 de hoje em Brasilia
      mk("tarde", "2026-10-27T19:00:00.000Z"),
      mk("longe", "2026-11-05T19:00:00.000Z"),
    ];
  };
  const a = await buildAgenda(now, fetcher);
  assert.deepEqual(a.games.map((g) => g.id), ["rolando", "tarde", "noite"]);
  assert.equal(brDay(new Date("2026-10-28T00:30:00.000Z")), "2026-10-27");

  await assert.rejects(buildAgenda(now, async () => { throw new Error("fora do ar"); }));

  resetAgendaCache();
  let builds = 0;
  const build = async (d) => {
    builds++;
    return { updated_at: d.toISOString(), games: [] };
  };
  const t = now.getTime();
  await getAgenda(null, { now: t, build });
  await getAgenda(null, { now: t + 10 * 60_000, build });
  assert.equal(builds, 1, "nao busca de novo dentro de 30 minutos");
  await getAgenda(null, { now: t + 31 * 60_000, build });
  assert.equal(builds, 2);
  const failing = async () => { throw new Error("fora do ar"); };
  const old = await getAgenda(null, { now: t + 70 * 60_000, build: failing });
  assert.ok(old, "fonte fora do ar: usa a ultima agenda");
  resetAgendaCache();
});
