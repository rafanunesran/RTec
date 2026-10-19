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
  source = http.createServer((_req, res) => res.end(SOURCE_M3U)).listen(0);
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

  const portal = await call("POST", "/api/portal/login", { username: "joao", password: "1234" });
  assert.equal(portal.body.playlists.length, 2);

  const device = await call("POST", "/api/devices", { client_id: client.body.id, mac: "001a2b3c4d5e", device_key: "777" });
  assert.equal(device.body.mac, "00:1A:2B:3C:4D:5E");
  assert.equal((await call("POST", "/api/devices", { client_id: client.body.id, mac: "00:1A:2B:3C:4D:5F" })).status, 400);
  const dev = await call("GET", "/api/device/playlists?mac=00:1A:2B:3C:4D:5E&key=777");
  assert.equal(dev.status, 200);
  assert.match(dev.body.playlists[0].url, /\/m3u\/.+\.m3u$/);
  assert.equal((await call("GET", "/api/device/playlists?mac=00:1A:2B:3C:4D:5E&key=000")).status, 401);

  await call("PUT", `/api/clients/${client.body.id}`, { expires_at: "2000-01-01T00:00:00Z" });
  assert.equal((await call("GET", "/get.php?username=joao&password=1234")).status, 401);
  assert.equal((await call("POST", "/api/portal/login", { username: "joao", password: "1234" })).status, 403);
});
