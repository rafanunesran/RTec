import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMarks, fromTheIntroDb, markKey, neighbors } from "./marks.js";

test("chave do episodio: outras linhas do mesmo fornecedor aproveitam a analise", () => {
  assert.equal(markKey("http://srv.tv:80/series/joao/1/123.mp4"), markKey("http://srv.tv:80/series/maria/2/123.mp4"));
  assert.notEqual(markKey("http://srv.tv/series/a/b/123.mp4"), markKey("http://srv.tv/series/a/b/124.mp4"));
  assert.notEqual(markKey("http://cdn.tv/s1/e1/index.m3u8"), markKey("http://cdn.tv/s1/e2/index.m3u8"));
});

test("vizinhos: proximo da mesma temporada primeiro", () => {
  const eps = [
    { season: 1, episode: 9, url: "a" },
    { season: 1, episode: 10, url: "b" },
    { season: 2, episode: 1, url: "c" },
  ];
  assert.deepEqual(neighbors(eps, 1).map((e) => e.url), ["a", "c"]);
  assert.deepEqual(neighbors(eps, 0).map((e) => e.url), ["b"]);
});

test("TheIntroDB: abertura, creditos e cena pos-creditos", () => {
  assert.deepEqual(fromTheIntroDb({ intro: [{ start_ms: null, end_ms: 90000 }], credits: [{ start_ms: 1500000, end_ms: null }] }), { intro: [0, 90], credits: 1500, post: false });
  assert.equal(fromTheIntroDb({ credits: [{ start_ms: 1500000, end_ms: 1560000 }] }, 1620).post, true, "60 s depois dos creditos");
  assert.equal(fromTheIntroDb({ credits: [{ start_ms: 1500000, end_ms: 1610000 }] }, 1620).post, false);
  assert.equal(fromTheIntroDb({}), null);
  assert.equal(cleanMarks({ intro: [50, 40], credits: 0 }), null);
});
