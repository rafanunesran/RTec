import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { probeServer, recordResults, serverTargets, summarize } from "./servermon.js";

function fakeServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

const xt = (base, user = "u", pass = "p") => ({ kind: "xtream", xtream_server: base, xtream_username: user, xtream_password: pass });

test("servidores: agrupa os clientes por servidor e testa com a lista de quem esta valendo", () => {
  const clients = [
    { id: "1", name: "Ana", username: "ana", source: xt("http://srv1:80", "a"), list_status: { state: "expired" } },
    { id: "2", name: "Bia", username: "bia", source: { kind: "m3u_url", url: "http://SRV1:80/get.php?username=b&password=x" } },
    { id: "3", name: "", username: "caio", source: xt("http://srv2:8080"), extra_sources: [xt("http://srv1:80", "c")] },
    { id: "4", username: "dani", source: { kind: "manual", content: "#EXTM3U" } },
  ];
  const t = serverTargets(clients);
  assert.deepEqual(t.map((x) => x.server), ["http://srv1", "http://srv2:8080"]);
  assert.deepEqual(t[0].clients.map((c) => c.name), ["Ana", "Bia", "caio"]);
  assert.equal(t[0].probes[0].url, "http://SRV1:80/get.php?username=b&password=x", "conta vencida fica por ultimo");
  assert.equal(t[0].probes.at(-1).xtream_username, "a");
});

test("servidores: no ar, lento, login recusado, erro 5xx e fora do ar", async () => {
  let delay = 0;
  let mode = "ok";
  const { srv, base } = await fakeServer((req, res) => {
    setTimeout(() => {
      if (mode === "500") return res.writeHead(502).end("bad gateway");
      if (mode === "html") return res.writeHead(200, { "Content-Type": "text/html" }).end("<html>parking</html>");
      const auth = new URL(req.url, base).searchParams.get("username") === "u" ? 1 : 0;
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ user_info: { auth, status: "Active" } }));
    }, delay);
  });
  try {
    let r = await probeServer(xt(base));
    assert.equal(r.state, "online");
    assert.ok(r.ms >= 0);
    r = await probeServer(xt(base, "outro"));
    assert.equal(r.state, "online", "servidor respondeu: esta no ar, mesmo recusando o login");
    assert.match(r.reason, /recusou o login/);
    mode = "html";
    assert.equal((await probeServer(xt(base))).state, "problem");
    mode = "500";
    r = await probeServer(xt(base), { retryDelayMs: 1 });
    assert.equal(r.state, "offline");
    assert.equal(r.http, 502);
    mode = "ok";
    delay = 300;
    r = await probeServer(xt(base), { timeoutMs: 100, retryDelayMs: 1 });
    assert.equal(r.state, "offline");
    assert.match(r.reason, /Não respondeu/);
  } finally {
    srv.close();
  }
  const r = await probeServer(xt("http://127.0.0.1:1"), { retryDelayMs: 1 });
  assert.equal(r.state, "offline");
  assert.match(r.reason, /conectar/);
});

test("servidores: M3U comum precisa trazer canais", async () => {
  const { srv, base } = await fakeServer((req, res) => res.writeHead(200).end(req.url === "/ok.m3u" ? "#EXTM3U\n#EXTINF:-1,Canal\nhttp://x" : ""));
  try {
    assert.equal((await probeServer({ kind: "m3u_url", url: `${base}/ok.m3u` })).state, "online");
    assert.equal((await probeServer({ kind: "m3u_url", url: `${base}/vazia.m3u` })).state, "problem");
  } finally {
    srv.close();
  }
});

test("servidores: historico guarda desde quando esta no estado e calcula as 24 h", () => {
  const t0 = Date.parse("2026-11-05T10:00:00Z");
  let doc = recordResults({}, { a: { state: "online", ms: 200 } }, { now: t0 });
  doc = recordResults(doc, { a: { state: "online", ms: 400 } }, { now: t0 + 300_000 });
  assert.equal(doc.servers.a.since, new Date(t0).toISOString());
  doc = recordResults(doc, { a: { state: "offline", ms: 10000, reason: "Nao respondeu" } }, { now: t0 + 600_000, by: "monitor" });
  const e = doc.servers.a;
  assert.equal(e.since, new Date(t0 + 600_000).toISOString());
  assert.equal(e.last_ok_at, new Date(t0 + 300_000).toISOString());
  assert.equal(doc.monitor_at, new Date(t0 + 600_000).toISOString());
  assert.deepEqual(summarize(e), { uptime: 66.7, avg_ms: 300, checks: 3 });
  // Testes com mais de 24 h saem do historico.
  doc = recordResults(doc, { a: { state: "online", ms: 100 } }, { now: t0 + 25 * 3600_000 });
  assert.equal(doc.servers.a.history.length, 1);
});
