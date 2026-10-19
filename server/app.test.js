import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rtec-test-"));
process.env.ADMIN_PASSWORD = "secret123";

const { seedAdmin } = await import("./db.js");
const { createApp } = await import("./app.js");

let api, source, base, cookie = "";

const SOURCE_M3U = '#EXTM3U\n#EXTINF:-1 tvg-logo="x.png" group-title="Noticias",Canal Remoto\nhttp://example.com/remoto.ts\n';
const HLS = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:4,\nseg/1.ts\n";

function sourceHandler(req, res) {
  if (req.url === "/live/index.m3u8") return res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" }).end(HLS);
  if (req.url === "/live/seg/1.ts") return res.writeHead(200, { "Content-Type": "video/mp2t" }).end("TSDATA");
  if (req.url === "/hls.m3u") {
    const port = source.address().port;
    return res.end(
      `#EXTM3U url-tvg="http://127.0.0.1:${port}/epg.xml"\n` +
        `#EXTINF:-1 tvg-id="hls.br" group-title="Ao vivo",Canal HLS\nhttp://127.0.0.1:${port}/live/index.m3u8\n` +
        `#EXTINF:-1 group-title="Filmes Acao",Filme X\nhttp://127.0.0.1:${port}/movie/u/p/10.mp4\n` +
        `#EXTINF:-1 group-title="Series Drama",Serie Y S01 E01\nhttp://127.0.0.1:${port}/series/u/p/20.mkv\n`,
    );
  }
  if (req.url === "/epg.xml") {
    const fmt = (d) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
    const now = Date.now();
    return res.end(
      `<tv><programme start="${fmt(new Date(now - 600000))}" stop="${fmt(new Date(now + 600000))}" channel="hls.br"><title>Jornal &amp; Cia</title></programme></tv>`,
    );
  }
  res.end(SOURCE_M3U);
}

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.includes("json") ? await res.json() : await res.text() };
}

before(async () => {
  seedAdmin();
  source = http.createServer(sourceHandler).listen(0);
  api = createApp().listen(0);
  base = `http://127.0.0.1:${api.address().port}`;
});

after(() => {
  api.close();
  source.close();
});

test("fluxo completo: admin, lista, cliente, M3U e dispositivo", async () => {
  assert.equal((await call("GET", "/api/clients")).status, 401);
  assert.equal((await call("POST", "/api/auth/login", { username: "admin", password: "errada" })).status, 401);
  assert.equal((await call("POST", "/api/auth/login", { username: "admin", password: "secret123" })).status, 200);

  const remote = await call("POST", "/api/playlists", {
    name: "Remota",
    kind: "m3u_url",
    url: `http://127.0.0.1:${source.address().port}/lista.m3u`,
  });
  assert.equal(remote.status, 201);
  const manual = await call("POST", "/api/playlists", {
    name: "Manual",
    kind: "manual",
    content: "#EXTM3U\n#EXTINF:-1,Canal Manual\nhttp://example.com/manual.ts",
  });
  assert.equal(manual.body.channel_count, 1);

  const preview = await call("GET", `/api/playlists/${remote.body.id}/preview`);
  assert.equal(preview.body.channel_count, 1);
  assert.deepEqual(preview.body.groups, ["Noticias"]);

  const client = await call("POST", "/api/clients", {
    name: "Joao",
    username: "joao",
    password: "1234",
    playlist_ids: [remote.body.id, manual.body.id],
  });
  assert.equal(client.status, 201);
  assert.equal((await call("POST", "/api/clients", { username: "joao" })).status, 409);

  const m3u = await call("GET", "/get.php?username=joao&password=1234&type=m3u_plus");
  assert.equal(m3u.status, 200);
  assert.match(m3u.body, /^#EXTM3U\n/);
  assert.equal(m3u.body.match(/#EXTM3U/g).length, 1);
  assert.match(m3u.body, /Canal Remoto/);
  assert.match(m3u.body, /Canal Manual/);

  const byToken = await call("GET", `/m3u/${client.body.token}.m3u`);
  assert.equal(byToken.status, 200);
  assert.equal((await call("GET", "/get.php?username=joao&password=errada")).status, 401);


  const device = await call("POST", "/api/devices", { client_id: client.body.id, mac: "001a2b3c4d5e", device_key: "777" });
  assert.equal(device.body.mac, "00:1A:2B:3C:4D:5E");
  assert.equal((await call("POST", "/api/devices", { client_id: client.body.id, mac: "00:1A:2B:3C:4D:5F" })).status, 400);
  const dev = await call("GET", "/api/device/playlists?mac=00:1A:2B:3C:4D:5E&key=777");
  assert.equal(dev.status, 200);
  assert.match(dev.body.playlists[0].url, /\/m3u\/.+\.m3u$/);
  assert.equal((await call("GET", "/api/device/playlists?mac=00:1A:2B:3C:4D:5E&key=000")).status, 401);

  await call("PUT", `/api/clients/${client.body.id}`, { expires_at: "2000-01-01T00:00:00Z" });
  assert.equal((await call("GET", "/get.php?username=joao&password=1234")).status, 401);
  assert.equal((await call("POST", "/api/player/login", { username: "joao", password: "1234" })).status, 403);
});

test("reprodutor: login do cliente, canais e proxy assinado", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const hls = await call("POST", "/api/playlists", { name: "HLS", kind: "m3u_url", url: `http://127.0.0.1:${source.address().port}/hls.m3u` });
  await call("POST", "/api/clients", { username: "ana", password: "abcd", playlist_ids: [hls.body.id] });

  cookie = "";
  assert.equal((await call("GET", "/api/player/channels")).status, 401);
  assert.equal((await call("POST", "/api/player/login", { username: "ana", password: "x" })).status, 401);
  const login = await call("POST", "/api/player/login", { username: "ana", password: "abcd" });
  assert.equal(login.body.username, "ana");
  assert.equal((await call("GET", "/api/player/me")).body.username, "ana");

  const channels = await call("GET", "/api/player/channels");
  assert.deepEqual(channels.body.playlists.map((p) => p.name), ["HLS"]);
  assert.equal(channels.body.channels.length, 3);
  const ch = channels.body.channels.find((c) => c.kind === "live");
  assert.equal(ch.epg_id, "hls.br");
  assert.deepEqual(channels.body.channels.map((c) => c.kind).sort(), ["live", "movie", "series"]);

  const epg = await call("GET", "/api/player/epg?ids=hls.br,outro");
  assert.equal(epg.body["hls.br"][0].title, "Jornal & Cia");
  assert.equal(epg.body.outro, undefined);
  assert.equal(ch.name, "Canal HLS");
  assert.equal(ch.group, "Ao vivo");
  assert.equal(ch.type, "hls");
  assert.match(ch.src, /^\/api\/player\/proxy\?u=/);

  const playlist = await call("GET", ch.src);
  assert.equal(playlist.status, 200);
  const lines = playlist.body.split("\n");
  assert.match(lines[1], /URI="\/api\/player\/proxy\?u=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Flive%2Fkey\.bin&s=/);
  const segment = await call("GET", lines[3]);
  assert.equal(segment.body, "TSDATA");

  const tampered = ch.src.replace("index.m3u8", "outro.m3u8");
  assert.equal((await call("GET", tampered)).status, 403);

  cookie = "";
  assert.equal((await call("GET", ch.src)).status, 401);
});

test("controle parental e ativacao por codigo do aparelho", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const client = await call("POST", "/api/clients", { username: "bia", password: "pw" });
  const adminCookie = cookie;

  // Aparelho novo: registra codigo e ainda nao esta vinculado
  cookie = "";
  const device = { device_id: "aa:bb:cc:00:11:22", device_key: "123456" };
  assert.equal((await call("POST", "/api/player/device/register", device)).body.linked, false);
  assert.equal((await call("POST", "/api/player/device/register", { ...device, device_key: "999999" })).status, 409);
  assert.equal((await call("GET", "/api/player/device/status?device_id=AA:BB:CC:00:11:22&device_key=123456")).body.linked, false);

  // Revendedor ve o pendente e vincula ao cliente
  cookie = adminCookie;
  const pending = await call("GET", "/api/devices/pending");
  assert.equal(pending.body[0].device_id, "AA:BB:CC:00:11:22");
  await call("POST", "/api/devices", { client_id: client.body.id, mac: device.device_id, device_key: device.device_key });
  assert.equal((await call("GET", "/api/devices/pending")).body.length, 0);

  // Aparelho consulta de novo e ja entra logado
  cookie = "";
  const status = await call("GET", "/api/player/device/status?device_id=AA:BB:CC:00:11:22&device_key=123456");
  assert.equal(status.body.linked, true);
  assert.equal((await call("GET", "/api/player/me")).body.username, "bia");

  // PIN padrao 0000, troca e grupos bloqueados
  assert.equal((await call("POST", "/api/player/pin/verify", { pin: "1111" })).status, 403);
  assert.equal((await call("POST", "/api/player/pin/verify", { pin: "0000" })).status, 200);
  assert.equal((await call("POST", "/api/player/pin", { current: "0000", pin: "12" })).status, 400);
  assert.equal((await call("POST", "/api/player/pin", { current: "0000", pin: "4321" })).status, 200);
  assert.equal((await call("POST", "/api/player/locked-groups", { pin: "0000", groups: ["Adultos"] })).status, 403);
  await call("POST", "/api/player/locked-groups", { pin: "4321", groups: ["Adultos", "Adultos"] });
  assert.deepEqual((await call("GET", "/api/player/settings")).body, { custom_pin: true, locked_groups: ["Adultos"] });

  // Revendedor reseta o PIN
  cookie = adminCookie;
  const reset = await call("PUT", `/api/clients/${client.body.id}`, { reset_pin: true });
  assert.equal(reset.body.custom_pin, false);
  assert.equal(reset.body.parental_pin_hash, undefined);
});
