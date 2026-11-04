import { test } from "node:test";
import assert from "node:assert/strict";
import { liveSeasons, seriesSchedule, tmdbSeason, tvmazeSeasons } from "./schedule.js";

const NOW = Date.parse("2026-11-04T12:00:00Z");

test("TMDB: total previsto da temporada e data de cada episodio", () => {
  const s = tmdbSeason({ season_number: 2, episodes: [{ episode_number: 1, name: "Volta", air_date: "2026-10-20" }, { episode_number: 2, name: "", air_date: null }] }, 8);
  assert.equal(s.season, 2);
  assert.equal(s.total, 8);
  assert.deepEqual(s.episodes[1], { episode: 2, name: "", date: "", at: "" });
});

test("TVmaze: agrupa por temporada, guarda a hora e tira o TBA", () => {
  const ss = tvmazeSeasons([
    { season: 1, number: 1, name: "Piloto", airdate: "2025-01-01", airstamp: "2025-01-02T02:00:00+00:00" },
    { season: 2, number: 1, name: "TBA", airdate: "", airstamp: null },
    { season: 2, number: null, name: "Especial", airdate: "2026-01-01" },
  ]);
  assert.equal(ss.length, 2);
  assert.equal(ss[0].episodes[0].at, "2025-01-02T02:00:00+00:00");
  assert.deepEqual(ss[1].episodes, [{ episode: 1, name: "", date: "", at: "" }]);
});

test("so temporadas em lancamento (episodio futuro, sem data ou recente)", () => {
  const ep = (episode, date) => ({ episode, name: "", date, at: "" });
  const old = { season: 1, total: 2, episodes: [ep(1, "2020-01-01"), ep(2, "2020-01-08")] };
  const airing = { season: 2, total: 10, episodes: [ep(2, "2026-10-28"), ep(1, "2026-10-21"), ep(3, "2026-11-11")] };
  assert.deepEqual(liveSeasons([airing, old], NOW).map((s) => s.season), [2]);
  assert.deepEqual(liveSeasons([airing], NOW)[0].episodes.map((e) => e.episode), [1, 2, 3], "em ordem");
  assert.equal(liveSeasons([old], NOW).length, 0, "serie terminada nao mostra nada");
  const announced = { season: 3, total: 0, episodes: [ep(1, ""), ep(2, "")] };
  assert.deepEqual(liveSeasons([old, airing, announced], NOW).map((s) => [s.season, s.total]), [[2, 10], [3, 2]]);
});

test("sem internet (RTEC_NO_ONLINE_INFO) nao busca nada", async () => {
  process.env.RTEC_NO_ONLINE_INFO = "1";
  assert.deepEqual(await seriesSchedule({ name: "Qualquer" }), { seasons: [], source: "" });
});

test("TVmaze pelo nome, com conferencia do nome e do ano", async () => {
  delete process.env.RTEC_NO_ONLINE_INFO;
  const saved = { fetch: globalThis.fetch, key: process.env.TMDB_API_KEY };
  delete process.env.TMDB_API_KEY;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const body = {
      id: 1,
      name: "Abelha Rainha",
      premiered: "2024-03-01",
      _embedded: { episodes: [{ season: 2, number: 1, name: "A", airdate: "2026-10-28", airstamp: "2026-10-29T01:00:00+00:00" }, { season: 2, number: 2, name: "B", airdate: "2026-11-11", airstamp: "2026-11-12T01:00:00+00:00" }] },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const out = await seriesSchedule({ name: "BR: Abelha Rainha [4K]", year: 2024 }, NOW);
    assert.equal(out.source, "TVmaze");
    assert.equal(out.seasons[0].total, 2);
    assert.match(urls[0], /singlesearch\/shows\?q=Abelha\+Rainha/);
    assert.deepEqual((await seriesSchedule({ name: "Abelha Rainha", year: 2010 }, NOW)).seasons, [], "ano bem diferente: outra serie");
    assert.deepEqual((await seriesSchedule({ name: "Outra Coisa" }, NOW)).seasons, [], "nome diferente");
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key) process.env.TMDB_API_KEY = saved.key;
  }
});
