import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.ADMIN_PASSWORD = "secret123";
process.env.RTEC_NO_ONLINE_INFO = "1"; // ficha dos titulos: sem buscar na internet durante os testes
process.env.PROXY_CHUNK_MB = "1"; // testa a entrega de filmes em pedacos (como na Vercel)
process.env.PROXY_SECRET = "teste-proxy";

const { setStore } = await import("./store/index.js");
const { createMemoryStore } = await import("./store/memory.js");
const { createFirestoreStore } = await import("./store/firestore.js");
const { createApp, ensureAdminAccount } = await import("./app.js");
const { openUrl } = await import("./seal.js");
/** Link do proxy com a URL do fornecedor aberta (ela vai cifrada no parametro u). */
const plain = (link) => {
  const q = new URL(link, "http://x").searchParams;
  return q.has("u") ? openUrl("teste-proxy", q.get("u")) : link;
};
// Com FIRESTORE_EMULATOR_HOST (npm run test:firestore) os mesmos testes rodam no Firestore de verdade.
setStore(process.env.FIRESTORE_EMULATOR_HOST ? createFirestoreStore() : createMemoryStore());

let api, source, base, cookie = "";

const SOURCE_M3U = '#EXTM3U\n#EXTINF:-1 tvg-logo="x.png" group-title="Noticias",Canal Remoto\nhttp://example.com/remoto.ts\n';
const HLS = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:4,\nseg/1.ts\n";

const MOVIE = Buffer.alloc(3 * 1024 * 1024, 7);
const b64 = (t) => Buffer.from(t).toString("base64");

// Conta "Renova" no fornecedor falso: muda entre ativa, vencida e fornecedor fora do ar.
let renova = "active";

function xtreamApi(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  if (q.get("username") === "Renova") {
    if (renova === "down") return res.writeHead(503).end("Service Unavailable");
    const exp = renova === "active" ? "1893456000" : "1600000000";
    return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ user_info: { auth: 1, status: renova === "active" ? "Active" : "Expired", exp_date: exp } }));
  }
  if (q.get("username") === "Extra" && q.get("password") === "E1") return extraApi(q, res);
  if (q.get("username") !== "TiaX" || q.get("password") !== "Sen@1") return res.end(JSON.stringify({ user_info: { auth: 0 } }));
  const json = (d) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(d));
  const port = source.address().port;
  switch (q.get("action")) {
    case null:
      return json({ user_info: { auth: 1, status: "Active", exp_date: "1893456000", max_connections: "2" }, server_info: {} });
    case "get_live_categories":
      return json([{ category_id: "10", category_name: "Esportes" }, { category_id: "11", category_name: "Adultos" }]);
    case "get_vod_categories":
      return json([{ category_id: "20", category_name: "Filmes | Acao" }]);
    case "get_series_categories":
      return json([{ category_id: "30", category_name: "Series | Drama" }, { category_id: "31", category_name: "Series | Netflix" }]);
    case "get_live_streams":
      return json(
        [
          { stream_id: 1, name: "ESPN", stream_icon: `http://127.0.0.1:${port}/logo.png`, category_id: "10" },
          { stream_id: 2, name: "Canal +18", stream_icon: "", category_id: "11" },
          // Radio: vem junto com os canais, numa categoria que get_live_categories nao lista.
          { stream_id: 3, name: "Radio Jovem FM", stream_icon: "", category_id: "40", stream_type: "radio_streams" },
        ].filter((x) => !q.get("category_id") || x.category_id === q.get("category_id")),
      );
    case "get_vod_streams":
      return json([
        // Copia gravada no cinema vem antes: junta com a normal, mas a normal e a que toca.
        { stream_id: 49, name: "Filme Teste (Cinema)", stream_icon: "", container_extension: "mp4", category_id: "20", year: "2015" },
        { stream_id: 50, name: "Filme Teste", stream_icon: "https://img.example/f.jpg", container_extension: "mp4", category_id: "20", added: "1700000000", year: "2015", rating: "6.1" },
        { stream_id: 51, name: "Abelha Rainha", stream_icon: "", container_extension: "mp4", category_id: "20", added: "1800000000", release_date: "2023-04-01", rating: "8.4", genre: "Suspense, Drama" },
        { stream_id: 52, name: "Zebra (1999)", stream_icon: "", container_extension: "mp4", category_id: "20", added: "1600000000", rating_5based: "4.5" },
      ]);
    case "get_series":
      return json(
        [
          { series_id: 70, name: "Serie Teste", cover: "https://img.example/s.jpg", category_id: "30" },
          // O fornecedor repete a serie em outra categoria (so esta copia traz a nota) e tem a versao legendada.
          { series_id: 71, name: "Serie Teste", cover: "", category_id: "31", rating: "8", year: "2013" },
          { series_id: 72, name: "Serie Teste [L]", cover: "", category_id: "31" },
        ].filter((x) => !q.get("category_id") || x.category_id === q.get("category_id")),
      );
    case "get_vod_info":
      if (q.get("vod_id") === "50") return json({ info: { name: "Filme Teste", genre: "Action", director: "Joao Silva", cast: "Outra Pessoa" } });
      if (q.get("vod_id") === "52") return json({ info: { name: "Zebra", genre: "Comedia, Familia" } });
      return json({
        info: { name: "Abelha Rainha", plot: "Uma apicultora aposentada enfrenta uma conspiracao para proteger a familia.", genre: "Acao, Suspense", cast: "Ana Lima, Rui Costa", director: "Joao Silva", releasedate: "2023-04-01", rating: "8.4", duration: "01:52:00", backdrop_path: ["http://img.example/b.jpg"], youtube_trailer: "abcDEF12345", movie_image: "https://img.example/a.jpg", tmdb_id: "99" },
        movie_data: { stream_id: 51, name: "Abelha Rainha" },
      });
    case "get_series_info":
      if (q.get("series_id") === "72") return json({ episodes: { 1: [{ id: 911, episode_num: 1, season: 1, title: "Ep 1", container_extension: "mp4" }] } });
      return json({ info: { cover: "https://img.example/capa.jpg" }, episodes: { 1: [{ id: 902, episode_num: 2, season: 1, title: "Ep 2", container_extension: "mkv" }, { id: 901, episode_num: 1, season: 1, title: "Ep 1", container_extension: "mp4" }] } });
    case "get_short_epg": {
      const now = Math.floor(Date.now() / 1000);
      return json({ epg_listings: [{ title: b64("Jogo ao vivo"), description: b64("Final"), start_timestamp: now - 600, stop_timestamp: now + 600 }] });
    }
  }
  res.end("[]");
}

// Segunda lista (outro fornecedor): repete alguns titulos da primeira e traz outros que faltam nela.
function extraApi(q, res) {
  const json = (d) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(d));
  switch (q.get("action")) {
    case null:
      return json({ user_info: { auth: 1, status: "Active", exp_date: "1924992000" } });
    case "get_live_categories":
      return json([{ category_id: "5", category_name: "ESPORTES" }, { category_id: "6", category_name: "Abertos" }]);
    case "get_vod_categories":
      return json([{ category_id: "7", category_name: "Filmes | Ação" }]);
    case "get_series_categories":
      return json([{ category_id: "8", category_name: "Series | Drama" }]);
    case "get_live_streams":
      return json([
        { stream_id: 101, name: "ESPN FHD", stream_icon: "", category_id: "5" },
        { stream_id: 102, name: "Globo", stream_icon: "", category_id: "6" },
      ]);
    case "get_vod_streams":
      return json([
        { stream_id: 150, name: "Filme Teste (2015)", stream_icon: "", container_extension: "mkv", category_id: "7", year: "2015" },
        { stream_id: 151, name: "Filme Novo", stream_icon: "", container_extension: "mp4", category_id: "7" },
      ]);
    case "get_series":
      return json([{ series_id: 80, name: "Serie Teste", cover: "", category_id: "8" }]);
    case "get_series_info":
      return json({ episodes: { 1: [{ id: 801, episode_num: 1, season: 1, title: "Ep 1", container_extension: "mp4" }, { id: 803, episode_num: 3, season: 1, title: "Ep 3", container_extension: "mp4" }] } });
    case "get_short_epg":
      return json({ epg_listings: [] });
  }
  res.end("[]");
}

function sourceHandler(req, res) {
  if (req.url.startsWith("/player_api.php")) return xtreamApi(req, res);
  if (req.url.startsWith("/movie/TiaX/")) {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
    if (!m) return res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": MOVIE.length }).end(MOVIE);
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), MOVIE.length - 1) : MOVIE.length - 1;
    return res
      .writeHead(206, { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${MOVIE.length}`, "Content-Length": end - start + 1, "Accept-Ranges": "bytes" })
      .end(MOVIE.subarray(start, end + 1));
  }
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
  // Placar simulado da ESPN (Jogos do dia): um jogo do Brasileirao hoje, os outros campeonatos fora do ar.
  if (req.url.startsWith("/espn/")) {
    if (!req.url.startsWith("/espn/soccer/bra.1/scoreboard")) return res.writeHead(404).end();
    const start = new Date(Date.now() + 3600_000).toISOString();
    const team = (homeAway, name) => ({ homeAway, score: "0", team: { displayName: name, logo: "https://a/x.png" } });
    return res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        events: [
          { id: "1", date: start, status: { type: { state: "pre" } }, competitions: [{ competitors: [team("home", "Flamengo"), team("away", "Palmeiras")], geoBroadcasts: [{ media: { shortName: "ESPN" } }] }] },
          { id: "2", date: start, status: { type: { state: "pre" } }, competitions: [{ competitors: [team("home", "Santos"), team("away", "Vasco")], broadcasts: [{ names: ["Record"] }] }] },
        ],
      }),
    );
  }
  if (req.url === "/pagina.html") return res.writeHead(200, { "Content-Type": "text/html" }).end("<html><body>login</body></html>");
  if (req.url === "/vazia.m3u") return res.end("");
  if (req.url === "/ua.m3u") return res.end(`#EXTM3U\n#EXTINF:-1,${req.headers["user-agent"]}\nhttp://example.com/ua.ts\n`);
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
  source = http.createServer(sourceHandler).listen(0);
  api = createApp().listen(0);
  base = `http://127.0.0.1:${api.address().port}`;
});

after(() => {
  api.close();
  source.close();
});

test("fluxo completo: admin, lista, cliente e dispositivo", async () => {
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

  assert.equal(client.body.token, undefined);
  assert.deepEqual(Object.keys(client.body.links), ["server"]);
  assert.equal((await call("GET", "/get.php?username=joao&password=1234&type=m3u_plus")).status, 404);

  await call("PUT", `/api/clients/${client.body.id}`, { active: false });
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
  const keyUri = /URI="([^"]+)"/.exec(lines[1])[1];
  assert.match(keyUri, /^\/api\/player\/proxy\?u=x[\w-]+&c=\w+&e=\d+&s=/);
  assert.doesNotMatch(lines.join("\n") + ch.src, /127\.0\.0\.1|live/, "o link do fornecedor nao aparece para o aparelho");
  assert.match(plain(keyUri), /^http:\/\/127\.0\.0\.1:\d+\/live\/key\.bin$/);
  const segment = await call("GET", lines[3]);
  assert.equal(segment.body, "TSDATA");

  const tampered = ch.src.replace(/u=x(.)/, (_m, a) => `u=x${a === "A" ? "B" : "A"}`);
  assert.equal((await call("GET", tampered)).status, 403);

  // Link assinado funciona sem cookie (servidor de video separado), mas expira e respeita bloqueio
  cookie = "";
  assert.equal((await call("GET", ch.src)).status, 200);
  const expired = ch.src.replace(/([?&]e=)\d+/, "$11000");
  assert.equal((await call("GET", expired)).status, 403);
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const ana = (await call("GET", "/api/clients")).body.find((c) => c.username === "ana");
  await call("PUT", `/api/clients/${ana.id}`, { active: false });
  cookie = "";
  assert.equal((await call("GET", ch.src)).status, 403);
});

test("controle parental (PIN)", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const client = await call("POST", "/api/clients", { username: "bia", password: "pw" });
  const adminCookie = cookie;

  cookie = "";
  await call("POST", "/api/player/login", { username: "bia", password: "pw" });
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

test("tocar em outro aparelho: mesmo canal e chave em todos os aparelhos da conta, diferente entre contas", async () => {
  cookie = "";
  assert.equal((await call("GET", "/api/player/cast")).status, 401);
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  await call("POST", "/api/clients", { username: "cast1", password: "pw" });
  await call("POST", "/api/clients", { username: "cast2", password: "pw" });

  const open = async (username) => {
    cookie = "";
    await call("POST", "/api/player/login", { username, password: "pw" });
    return (await call("GET", "/api/player/cast")).body;
  };
  const tv = await open("cast1");
  const celular = await open("cast1");
  const outra = await open("cast2");
  assert.deepEqual(tv, celular);
  assert.equal(tv.relay, "https://ntfy.sh");
  assert.match(tv.topic, /^rtec_[0-9a-f]{32}$/);
  assert.equal(Buffer.from(tv.key, "base64url").length, 32);
  assert.notEqual(outra.topic, tv.topic);
  assert.notEqual(outra.key, tv.key);
});

test("modo direto: so links https tocam direto; http sempre passa pelo servidor", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const p = await call("POST", "/api/playlists", {
    name: "Direta",
    kind: "manual",
    playback: "direct",
    content: "#EXTM3U\n#EXTINF:-1,Xtream TS\nhttps://cdn.example/live/u/p/7.ts\n#EXTINF:-1,Canal http\nhttp://cdn.example/canal.m3u8\n",
  });
  assert.equal(p.body.playback, "direct");
  assert.equal((await call("POST", "/api/playlists", { name: "X", kind: "manual", playback: "outro", content: "#EXTINF:-1,a\nhttp://a" })).status, 400);
  await call("POST", "/api/clients", { username: "dani", password: "pw", playlist_ids: [p.body.id] });
  cookie = "";
  await call("POST", "/api/player/login", { username: "dani", password: "pw" });
  const [xt, plain] = (await call("GET", "/api/player/channels")).body.channels;
  assert.equal(xt.src, "https://cdn.example/live/u/p/7.m3u8", "Xtream https direto prefere HLS");
  assert.equal(xt.type, "hls");
  assert.equal(xt.alt, "https://cdn.example/live/u/p/7.ts");
  assert.equal(xt.alt_type, "mpegts");
  assert.match(plain.src, /^\/api\/player\/proxy\?/, "http nunca vai direto, mesmo no modo direto");
});

test("recuperacao do admin: ADMIN_RESET_PASSWORD redefine a senha uma vez por valor", async () => {
  const db = createMemoryStore();
  const bcrypt = (await import("bcryptjs")).default;
  const login = async (pw) => bcrypt.compareSync(pw, (await db.admins.findOne("username", "admin")).password_hash);

  process.env.ADMIN_PASSWORD = "  primeira \n";
  await ensureAdminAccount(db);
  assert.equal(await login("primeira"), true, "espacos e quebras de linha da variavel sao ignorados");

  process.env.ADMIN_PASSWORD = "outra";
  await ensureAdminAccount(db);
  assert.equal(await login("primeira"), true, "ADMIN_PASSWORD nao muda um admin ja existente");

  process.env.ADMIN_RESET_PASSWORD = "nova-senha";
  await ensureAdminAccount(db);
  assert.equal(await login("nova-senha"), true);

  // Trocada depois no painel, a senha nao volta a ser resetada pelo mesmo valor
  const admin = await db.admins.findOne("username", "admin");
  await db.admins.update(admin.id, { password_hash: bcrypt.hashSync("do-painel", 4) });
  await ensureAdminAccount(db);
  assert.equal(await login("do-painel"), true);

  delete process.env.ADMIN_RESET_PASSWORD;
  process.env.ADMIN_PASSWORD = "secret123";
  assert.equal((await db.admins.list()).length, 1);
});

test("sem senha padrao: publicado sem ADMIN_PASSWORD nao cria admin", async () => {
  const db = createMemoryStore();
  delete process.env.ADMIN_PASSWORD;
  process.env.VERCEL = "1";
  try {
    await ensureAdminAccount(db);
    assert.equal((await db.admins.list()).length, 0);
  } finally {
    delete process.env.VERCEL;
    process.env.ADMIN_PASSWORD = "secret123";
  }
  await ensureAdminAccount(db);
  assert.equal((await db.admins.list()).length, 1);
});

test("cabecalhos de seguranca na API", async () => {
  const r = await fetch(`${base}/api/auth/me`, { headers: { "x-forwarded-proto": "https" } });
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.match(r.headers.get("strict-transport-security") || "", /max-age=/);
});

test("lista propria do cliente: colar no cadastro, testar e assistir", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const port = source.address().port;
  const src = { kind: "m3u_url", url: `http://127.0.0.1:${port}/hls.m3u`, playback: "proxy" };

  const preview = await call("POST", "/api/source/preview", src);
  assert.equal(preview.body.ok, true);
  assert.deepEqual(preview.body.kinds, { live: 1, radio: 0, movie: 1, series: 1 });
  assert.equal((await call("POST", "/api/source/preview", { kind: "m3u_url", url: "ftp://x" })).status, 400);
  assert.equal((await call("POST", "/api/clients", { username: "edu", password: "pw", source: { kind: "xtream", xtream_server: "http://a" } })).status, 400);

  const client = await call("POST", "/api/clients", { name: "Edu", username: "edu", password: "pw", source: src });
  assert.equal(client.status, 201);
  assert.equal(client.body.source.kind, "m3u_url");
  const adminCookie = cookie;

  cookie = "";
  await call("POST", "/api/player/login", { username: "edu", password: "pw" });
  const res = await call("GET", "/api/player/channels");
  assert.equal(res.body.channels.length, 3);
  assert.equal(res.body.playlists[0].name, "Edu");

  // Trocar para lista colada
  cookie = adminCookie;
  const updated = await call("PUT", `/api/clients/${client.body.id}`, {
    source: { kind: "manual", content: "#EXTM3U\n#EXTINF:-1,Colado\nhttps://example.com/c.m3u8", playback: "direct" },
  });
  assert.equal(updated.body.source.url, "");
  cookie = "";
  await call("POST", "/api/player/login", { username: "edu", password: "pw" });
  const after = await call("GET", "/api/player/channels");
  assert.deepEqual(after.body.channels.map((c) => [c.name, c.src]), [["Colado", "https://example.com/c.m3u8"]]);
});

test("reprodutor mostra por que a lista nao carregou", async () => {
  const port = source.address().port;
  const check = async (username, src) => {
    cookie = "";
    await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
    await call("POST", "/api/clients", { username, password: "pw", source: src });
    cookie = "";
    await call("POST", "/api/player/login", { username, password: "pw" });
    return (await call("GET", "/api/player/channels")).body;
  };
  const html = await check("erro1", { kind: "m3u_url", url: `http://127.0.0.1:${port}/pagina.html` });
  assert.equal(html.channels.length, 0);
  assert.match(html.errors[0], /abriu uma pagina/);
  // Lista que voltou vazia = fornecedor cortou o acesso: tela de lista expirada
  const empty = await check("erro2", { kind: "m3u_url", url: `http://127.0.0.1:${port}/vazia.m3u` });
  assert.equal(empty.code, "list_expired");
  const down = await check("erro3", { kind: "m3u_url", url: "http://127.0.0.1:1/x.m3u" });
  assert.match(down.errors[0], /Nao foi possivel conectar/);
  const none = await check("erro4", undefined);
  assert.equal(none.no_source, true);
  // Os fornecedores recebem a identificacao de um player conhecido (VLC)
  const ua = await check("erro5", { kind: "m3u_url", url: `http://127.0.0.1:${port}/ua.m3u` });
  assert.match(ua.channels[0].name, /^VLC\//);
});

test("cliente rapido com link Xtream e catalogo por categoria", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const port = source.address().port;
  const link = `http://127.0.0.1:${port}/get.php?username=TiaX&password=Sen%401&type=m3u_plus&output=m3u8`;

  assert.equal((await call("POST", "/api/clients/quick", { link: "http://x/lista.m3u" })).status, 400);
  const bad = await call("POST", "/api/clients/quick", { link: link.replace("Sen%401", "errada") });
  assert.match(bad.body.error, /recusou/);

  const quick = await call("POST", "/api/clients/quick", { link });
  assert.equal(quick.status, 201);
  assert.equal(quick.body.username, "TiaX");
  assert.equal(quick.body.password, "Sen@1");
  assert.equal(quick.body.expires_at, "2030-01-01T00:00:00.000Z");
  assert.equal(quick.body.source.kind, "xtream");
  assert.equal(quick.body.source.playback, "auto");
  assert.equal((await call("POST", "/api/clients/quick", { link })).status, 409);

  cookie = "";
  await call("POST", "/api/player/login", { username: "TiaX", password: "Sen@1" });
  const catalog = (await call("GET", "/api/player/catalog")).body;
  assert.equal(catalog.mode, "xtream");
  assert.deepEqual(catalog.sections.live.map((c) => c.name), ["Esportes", "Adultos"]);

  const live = (await call("GET", "/api/player/xtream/items?section=live")).body;
  assert.equal(live.length, 2);
  assert.equal(live[0].group, "Esportes");
  assert.equal(live[0].type, "mpegts");
  assert.match(live[0].src, /^\/api\/player\/proxy\?/, "link http passa pelo servidor no modo automatico");
  assert.match(live[0].logo, /^\/api\/player\/proxy\?/);
  assert.equal(live[0].epg_id, "xt:1");

  // Radios: secao propria, fora da TV ao vivo
  assert.deepEqual(catalog.sections.radio, [{ id: "40", name: "Rádios" }]);
  const radios = (await call("GET", "/api/player/xtream/items?section=radio")).body;
  assert.deepEqual(radios.map((r) => [r.name, r.kind, r.group]), [["Radio Jovem FM", "radio", "Rádios"]]);
  assert.equal(radios[0].epg_id, "");
  assert.match(plain(radios[0].src), /\/live\/TiaX\/Sen%401\/3\.ts$/);

  const movies = (await call("GET", "/api/player/xtream/items?section=movie&category=20")).body;
  assert.equal(movies[0].logo, "https://img.example/f.jpg", "logo https vai direto");
  assert.equal((await call("GET", "/api/player/xtream/items?section=movie")).status, 400);
  const allMovies = (await call("GET", "/api/player/xtream/items?section=movie&limit=10&q=teste")).body;
  assert.equal(allMovies.total, 1, "Todos: catalogo inteiro em paginas, com busca");
  assert.equal(allMovies.items[0].name, "Filme Teste");
  const cine = allMovies.items[0];
  assert.match(plain(cine.src), /\/50\.mp4$/, "a copia de cinema chegou primeiro, mas a normal e a que toca");
  assert.deepEqual(cine.versions.map((v) => [v.tag, v.label]), [["|", "Normal"], ["|CINEMA", "Cinema"]]);
  assert.equal(cine.xt_id, "50");
  assert.equal((await call("GET", "/api/player/xtream/items?section=movie&limit=10&skip=20")).body.total, 0, "pula categorias bloqueadas");

  // Filme pelo proxy: entregue em pedacos de 1 MB
  const first = await fetch(base + movies[0].src, { headers: { cookie, range: "bytes=0-" } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get("content-range"), `bytes 0-1048575/${MOVIE.length}`);
  assert.equal((await first.arrayBuffer()).byteLength, 1048576);

  const series = (await call("GET", "/api/player/xtream/items?section=series&category=30")).body;
  assert.deepEqual(series.map((s) => [s.series_id, s.rating]), [["70", 8]], "repetida na mesma lista vira uma so, com a nota da copia");
  const netflix = (await call("GET", "/api/player/xtream/items?section=series&category=31")).body;
  assert.deepEqual(netflix.map((s) => s.series_id), ["70"], "na outra categoria aparece a mesma (a legendada tambem vira versao dela)");
  const busca = (await call("GET", "/api/player/xtream/items?section=series&limit=10&q=serie")).body;
  assert.equal(busca.total, 1);
  const vers = (await call("GET", "/api/player/xtream/series/70?name=Serie%20Teste")).body;
  assert.deepEqual(vers[0].versions.map((v) => [v.tag, v.label]), [["|", "Dublado"], ["L|", "Legendado"]], "EP 1 tem a versao legendada");
  assert.match(plain(vers[0].versions[1].src), /911\.mp4/);
  assert.equal(vers[0].tag, "|");
  assert.equal(vers[1].versions, undefined, "EP 2 so existe dublado");
  const eps71 = (await call("GET", "/api/player/xtream/series/71?name=Serie%20Teste")).body;
  assert.deepEqual(eps71.map((e) => [e.season, e.episode]), [[1, 1], [1, 2]], "id da copia (favorito antigo) ainda abre os episodios sem repetir");
  const eps = (await call("GET", "/api/player/xtream/series/70?name=Serie%20Teste")).body;
  assert.deepEqual(eps.map((e) => [e.name, e.season, e.episode]), [["Ep 1", 1, 1], ["Ep 2", 1, 2]]);
  assert.equal(eps[0].parent_series, "70");
  assert.equal(eps[0].cover, "https://img.example/capa.jpg", "episodio leva a capa da serie (para o historico)");
  const acc = (await call("GET", "/api/player/xtream/items?section=movie&limit=10&q=TESTE")).body;
  assert.equal(acc.items[0].name, "Filme Teste", "busca ignora maiusculas/acentos");
  assert.match(plain(eps[1].src), /\/series\/TiaX\/Sen%401\/902\.mkv/);

  const epg = (await call("GET", "/api/player/epg?ids=xt:1")).body;
  assert.equal(epg["xt:1"][0].title, "Jogo ao vivo");

  // Jogos do dia: agenda montada no servidor e cruzada com os canais ao vivo do cliente
  process.env.GAMES_API_URL = `http://127.0.0.1:${port}/espn`;
  const games = (await call("GET", "/api/player/games")).body;
  delete process.env.GAMES_API_URL;
  assert.deepEqual(games.games.map((g) => `${g.home.name} x ${g.away.name}`), ["Flamengo x Palmeiras", "Santos x Vasco"]);
  const [fla, santos] = games.games;
  assert.deepEqual(fla.channels.map((ch) => [ch.name, ch.group, ch.broadcast]), [["ESPN", "Esportes", "ESPN"]]);
  assert.match(fla.channels[0].src, /^\/api\/player\/proxy\?/, "canal pronto para tocar");
  assert.deepEqual(santos.broadcasts, ["Record"]);
  assert.deepEqual(santos.channels, [], "canal que o cliente nao tem");
});

test("alertas de novos episodios: favorita entra sozinha, sino liga e desliga, por perfil", async () => {
  cookie = "";
  await call("POST", "/api/player/login", { username: "TiaX", password: "Sen@1" });
  assert.deepEqual((await call("GET", "/api/player/alerts")).body.items, []);
  const serie = { id: "s70", series_id: "70", name: "Serie Teste", kind: "series", logo: "", src: "", type: "file", group: "Serie Teste" };
  await call("PUT", "/api/player/sync", { favorites: [serie] });
  const first = (await call("GET", "/api/player/alerts")).body;
  assert.equal(first.mode, "xtream");
  assert.deepEqual(first.items.map((i) => [i.id, i.fav, i.new, i.base?.count]), [["s70", true, 0, 2]], "conferiu no fornecedor e guardou os 2 EPs");
  assert.equal((await call("PUT", "/api/player/alerts", { id: "s70", series_id: "70", name: "Serie Teste", on: false })).status, 200);
  assert.deepEqual((await call("GET", "/api/player/alerts")).body.items, [], "desligado no sino");
  // Episodio a menos do que o servidor conhece: "viu" 1, o fornecedor tem 2 -> 1 novo depois da proxima conferida.
  await call("PUT", "/api/player/alerts", { id: "s70", series_id: "70", name: "Serie Teste", on: true, count: 1, top: 10001 });
  assert.equal((await call("POST", "/api/player/alerts/seen", { id: "x" })).status, 400);
  assert.equal((await call("GET", "/api/player/alerts")).body.items[0].new, 0, "ainda nao conferiu de novo (3 h)");
  assert.deepEqual((await call("GET", "/api/player/alerts?profile=nao-existe")).status, 404);
  await call("PUT", "/api/player/sync", { favorites: [] });
});

test("pular intro: servidor de video analisa o episodio com o vizinho e o resultado fica guardado", async () => {
  cookie = "";
  await call("POST", "/api/player/login", { username: "TiaX", password: "Sen@1" });
  assert.deepEqual((await call("GET", "/api/player/marks?series=70&season=1&episode=1")).body, { marks: null, pending: false }, "sem servidor de video nem base publica");

  const seen = [];
  let ready = false;
  const video = http
    .createServer((req, res) => {
      const q = new URL(req.url, "http://x").searchParams;
      seen.push(q.get("u").split("~").map((t) => openUrl("teste-proxy", t)));
      const eps = [{ intro: [62.4, 104.1], credits: 1290.5, post: false }, { intro: [10, 52], credits: 1300, post: true }];
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(ready ? { status: "done", eps } : { status: "pending" }));
    })
    .listen(0);
  process.env.STREAM_PROXY_URL = `http://127.0.0.1:${video.address().port}`;
  try {
    assert.deepEqual((await call("GET", "/api/player/marks?series=70&season=1&episode=1")).body, { marks: null, pending: true });
    assert.equal(seen[0].length, 2, "episodio pedido e o proximo da temporada");
    assert.match(seen[0][0], /\/series\/TiaX\/Sen%401\/901\.mp4$/);
    assert.match(seen[0][1], /902\.mkv$/);
    ready = true;
    assert.deepEqual((await call("GET", "/api/player/marks?series=70&season=1&episode=1")).body.marks, { intro: [62.4, 104.1], credits: 1290.5, post: false });
    const n = seen.length;
    assert.deepEqual((await call("GET", "/api/player/marks?series=70&season=1&episode=2")).body.marks, { intro: [10, 52], credits: 1300, post: true }, "vizinho ja ficou pronto");
    assert.deepEqual((await call("GET", "/api/player/marks?series=70&season=1&episode=1")).body.marks.intro, [62.4, 104.1]);
    assert.equal(seen.length, n, "guardado no banco: nao analisa de novo");
  } finally {
    delete process.env.STREAM_PROXY_URL;
    video.close();
  }
});

test("trocar a lista nao perde historico e favoritos: religa cada titulo pelo nome", async () => {
  cookie = "";
  await call("POST", "/api/player/login", { username: "TiaX", password: "Sen@1" });
  const catalog = (await call("GET", "/api/player/catalog")).body;
  assert.match(catalog.sig, /^[0-9a-f]{12}$/, "assinatura da lista, para o aparelho saber quando ela mudou");
  const old = (id, kind, name, extra = {}) => ({ id, kind, name, group: "Lista antiga", logo: "", src: "http://antigo/x", type: "hls", epg_id: "", playlist_id: "own-x", alt: "", alt_type: "", ...extra });
  const { items } = (
    await call("POST", "/api/player/relink", {
      items: [
        old("a1", "live", "BR: ESPN HD"),
        old("a2", "movie", "Abelha Rainha (2023) [4K] - Dublado"),
        old("serie:Serie Teste", "series", "Serie Teste"),
        old("a4", "series", "Serie Teste S01E02"),
        old("a5", "movie", "Filme que saiu da lista"),
      ],
    })
  ).body;
  assert.equal(items[0].name, "ESPN");
  assert.equal(items[0].epg_id, "xt:1");
  assert.equal(items[1].name, "Abelha Rainha");
  assert.equal(items[1].group, "Filmes | Acao");
  assert.equal(items[2].series_id, "70");
  assert.equal(items[3].parent_series, "70");
  assert.deepEqual([items[3].season, items[3].episode, items[3].group], [1, 2, "Serie Teste"]);
  assert.match(plain(items[3].src), /902\.mkv/);
  assert.equal(items[4], null, "titulo que nao existe mais fica como estava no aparelho");
});

test("varias listas no mesmo cliente: um catalogo so, sem repetir titulos, com as outras listas de reserva", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const port = source.address().port;
  const server = `http://127.0.0.1:${port}`;
  const created = await call("POST", "/api/clients", {
    username: "duas_listas",
    password: "x1",
    source: { kind: "xtream", xtream_server: server, xtream_username: "TiaX", xtream_password: "Sen@1", playback: "direct" },
    extra_sources: [
      { kind: "m3u_url", url: `${server}/get.php?username=Extra&password=E1&type=m3u_plus`, playback: "direct" },
      { kind: "xtream", xtream_server: server, xtream_username: "TiaX", xtream_password: "Sen@1" }, // repetida: ignorada
    ],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.extra_sources.length, 1);
  assert.equal(created.body.list_status.state, "active");
  assert.equal(created.body.expires_at, "2031-01-01T00:00:00.000Z", "vale a lista que vence por ultimo");

  cookie = "";
  await call("POST", "/api/player/login", { username: "duas_listas", password: "x1" });
  const catalog = (await call("GET", "/api/player/catalog")).body;
  assert.equal(catalog.mode, "xtream");
  // Categorias de mesmo nome viram uma so; as da principal mantem o id.
  assert.deepEqual(catalog.sections.live.map((c) => c.name), ["Esportes", "Adultos", "Abertos"]);
  assert.equal(catalog.sections.live[0].id, "10");
  assert.deepEqual(catalog.sections.movie.map((c) => c.id), ["20"]);

  const live = (await call("GET", "/api/player/xtream/items?section=live")).body;
  assert.deepEqual(live.map((c) => c.name), ["ESPN", "Canal +18", "Globo"], "ESPN nao se repete");
  assert.equal(live[0].epg_id, "xt:1", "item da principal fica com o mesmo id de sempre");
  assert.equal(live[0].more.length, 1, "ESPN da outra lista vira reserva");
  assert.match(plain(live[0].more[0].src), /\/live\/Extra\/E1\/101\.ts/);
  assert.match(live[2].epg_id, /^xt:[0-9a-f]{6}~102$/);
  const esportes = (await call("GET", "/api/player/xtream/items?section=live&category=10")).body;
  assert.deepEqual(esportes.map((c) => c.name), ["ESPN"]);
  const abertos = (await call("GET", `/api/player/xtream/items?section=live&category=${encodeURIComponent(catalog.sections.live[2].id)}`)).body;
  assert.deepEqual(abertos.map((c) => c.name), ["Globo"]);

  const movies = (await call("GET", "/api/player/xtream/items?section=movie&category=20&sort=az")).body;
  assert.deepEqual(movies.map((m) => m.name), ["Abelha Rainha", "Filme Novo", "Filme Teste", "Zebra (1999)"]);
  const teste = movies.find((m) => m.name === "Filme Teste");
  assert.match(plain(teste.more[0].src), /\/movie\/Extra\/E1\/150\.mkv/);
  const novo = movies.find((m) => m.name === "Filme Novo");
  assert.match(novo.xt_id, /^[0-9a-f]{6}~151$/);
  const paged = (await call("GET", "/api/player/xtream/items?section=movie&limit=10")).body;
  assert.equal(paged.total, 4);

  const series = (await call("GET", "/api/player/xtream/items?section=series&category=30")).body;
  assert.deepEqual(series.map((s) => s.series_id), ["70"]);
  const eps = (await call("GET", "/api/player/xtream/series/70?name=Serie%20Teste")).body;
  assert.deepEqual(eps.map((e) => [e.season, e.episode]), [[1, 1], [1, 2], [1, 3]], "episodio que falta vem da outra lista");
  assert.match(plain(eps[0].more[0].src), /801\.mp4/);
  assert.equal(eps[1].more, undefined);
  assert.match(plain(eps[2].src), /803\.mp4/);
  assert.equal(eps[2].parent_series, "70");

  const epg = (await call("GET", `/api/player/epg?ids=${encodeURIComponent(live[2].epg_id)}`)).body;
  assert.deepEqual(epg[live[2].epg_id], []);
  const info = (await call("GET", `/api/player/info?kind=movie&id=${encodeURIComponent(novo.xt_id)}&name=Filme%20Novo`)).body;
  assert.equal(info.name, "Filme Novo");

  // Historico guarda as reservas e religa pelo nome.
  const sync = (await call("PUT", "/api/player/sync", { history: [teste] })).body;
  assert.equal(sync.history[0].more.length, 1);
  const { items } = (await call("POST", "/api/player/relink", { items: [{ ...teste, id: "x", src: "http://antigo" }, { ...eps[2], id: "y" }] })).body;
  assert.equal(items[0].id, teste.id);
  assert.match(plain(items[1].src), /803\.mp4/);

  // Lista extra vencida sai do catalogo; o cliente continua com a principal.
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  renova = "expired";
  const id = created.body.id;
  const upd = await call("PUT", `/api/clients/${id}`, {
    extra_sources: [{ kind: "xtream", xtream_server: server, xtream_username: "Renova", xtream_password: "r" }, { kind: "m3u_url", url: `${server}/get.php?username=Extra&password=E1` }],
  });
  assert.equal(upd.body.list_status.state, "active");
  assert.deepEqual(Object.values(upd.body.list_status.sources).sort(), ["active", "active", "expired"]);
  renova = "active";
});

test("radios em lista M3U: grupo Radios, radio=\"true\" e audio direto", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const content =
    "#EXTM3U\n" +
    '#EXTINF:-1 group-title="Noticias",Canal TV\nhttps://a.example/live/u/p/1.ts\n' +
    '#EXTINF:-1 group-title="RÁDIOS | Sertanejo",Radio A\nhttps://a.example/live/u/p/2.ts\n' +
    '#EXTINF:-1 radio="true" group-title="Musica",Radio B\nhttps://icecast.example:8000/stream\n' +
    '#EXTINF:-1 group-title="Variados",Radio C\nhttps://b.example/radio.mp3\n';
  assert.equal((await call("POST", "/api/clients", { username: "radios_m3u", password: "x1", source: { kind: "manual", content } })).status, 201);
  cookie = "";
  await call("POST", "/api/player/login", { username: "radios_m3u", password: "x1" });
  const data = (await call("GET", "/api/player/channels")).body;
  assert.deepEqual(data.channels.map((c) => [c.name, c.kind]), [["Canal TV", "live"], ["Radio A", "radio"], ["Radio B", "radio"], ["Radio C", "radio"]]);
  assert.deepEqual(data.channels.slice(1).map((c) => c.type), ["hls", "file", "file"], "radio sem extensao toca no proprio navegador");
});

test("varias listas M3U: titulos repetidos aparecem uma vez, com reserva", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const port = source.address().port;
  const created = await call("POST", "/api/clients", {
    username: "duas_m3u",
    password: "x1",
    source: { kind: "manual", content: "#EXTM3U\n#EXTINF:-1 group-title=\"Noticias\",Canal Remoto HD\nhttps://a.example/1.m3u8\n#EXTINF:-1 group-title=\"Filmes\",Filme A (2020)\nhttps://a.example/f.mp4\n" },
    extra_sources: [{ kind: "m3u_url", url: `http://127.0.0.1:${port}/lista.m3u` }],
  });
  assert.equal(created.status, 201);
  cookie = "";
  await call("POST", "/api/player/login", { username: "duas_m3u", password: "x1" });
  assert.equal((await call("GET", "/api/player/catalog")).body.mode, "m3u");
  const data = (await call("GET", "/api/player/channels")).body;
  assert.equal(data.playlists.length, 1, "aparece como uma lista so");
  assert.deepEqual(data.channels.map((c) => c.name), ["Canal Remoto HD", "Filme A (2020)"]);
  assert.equal(data.channels[0].more[0].src.includes("remoto.ts") || data.channels[0].more[0].src.includes("proxy"), true);
});

test("app Android recebe link direto; servidor de video externo recebe links absolutos", async () => {
  cookie = "";
  await call("POST", "/api/player/login", { username: "TiaX", password: "Sen@1" });
  const port = source.address().port;
  const appRes = await fetch(base + "/api/player/xtream/items?section=live", {
    headers: { cookie, "user-agent": "Mozilla/5.0 (Linux; Android 14; wv) Chrome/126 Mobile RTecApp/1.0" },
  });
  const [appCh] = await appRes.json();
  assert.equal(appCh.src, `http://127.0.0.1:${port}/live/TiaX/Sen%401/1.ts`, "no app o video vai direto do fornecedor");
  assert.match(appCh.fallback, /^\/api\/player\/proxy\?/, "se o direto falhar, o app tenta pelo servidor");

  process.env.STREAM_PROXY_URL = "https://video.exemplo.com/";
  try {
    const [webCh] = (await call("GET", "/api/player/xtream/items?section=live")).body;
    assert.match(webCh.src, /^https:\/\/video\.exemplo\.com\/api\/player\/proxy\?u=/);
    // O link gerado continua valido (mesma assinatura) quando chega no servidor de video
    const local = webCh.src.replace("https://video.exemplo.com", "");
    const r = await fetch(base + local, { headers: { range: "bytes=0-10" } });
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
    await r.body?.cancel();
  } finally {
    delete process.env.STREAM_PROXY_URL;
  }
});

test("servidor de video separado (Oracle) aceita os links assinados pelo painel", async () => {
  const { spawn } = await import("node:child_process");
  process.env.PROXY_SECRET = "segredo-compartilhado";
  const proxy = spawn(process.execPath, ["public/proxy/server.mjs"], { env: { ...process.env, PORT: "18089" }, stdio: "pipe" });
  try {
    await new Promise((ok) => proxy.stdout.on("data", (d) => String(d).includes("rodando") && ok()));
    cookie = "";
    await call("POST", "/api/player/login", { username: "ana", password: "abcd" }).catch(() => {});
    await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
    const port = source.address().port;
    await call("POST", "/api/clients", { username: "vps", password: "pw", source: { kind: "m3u_url", url: `http://127.0.0.1:${port}/hls.m3u` } });
    cookie = "";
    await call("POST", "/api/player/login", { username: "vps", password: "pw" });
    process.env.STREAM_PROXY_URL = "http://127.0.0.1:18089";
    const ch = (await call("GET", "/api/player/channels")).body.channels.find((c) => c.kind === "live");
    delete process.env.STREAM_PROXY_URL;
    assert.match(ch.src, /^http:\/\/127\.0\.0\.1:18089\/api\/player\/proxy\?/);

    const playlist = await fetch(ch.src);
    assert.equal(playlist.headers.get("access-control-allow-origin"), "*");
    const lines = (await playlist.text()).split("\n");
    const segment = await fetch("http://127.0.0.1:18089" + lines[3]);
    assert.equal(await segment.text(), "TSDATA");
    assert.equal((await fetch(ch.src.replace("index.m3u8", "x.m3u8"))).status, 403);
  } finally {
    delete process.env.PROXY_SECRET;
    proxy.kill();
  }
});

test("sincronizacao: favoritos, historico e ponto onde parou valem em qualquer aparelho da conta", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  await call("POST", "/api/clients", { username: "edu", password: "pw" });
  const filme = { id: "m1", name: "Filme", group: "Acao", logo: "", src: "http://a/1.mp4", type: "file", kind: "movie", epg_id: "", playlist_id: "own", alt: "", alt_type: "", hack: "x" };
  const canal = { ...filme, id: "c1", name: "Canal", kind: "live" };

  // Aparelho 1
  cookie = "";
  assert.equal((await call("GET", "/api/player/sync")).status, 401);
  await call("POST", "/api/player/login", { username: "edu", password: "pw" });
  const empty = (await call("GET", "/api/player/sync")).body;
  assert.deepEqual(empty, { favorites: [], favorites_t: 0, history: [], history_t: 0, progress: {} });
  const saved = await call("PUT", "/api/player/sync", {
    favorites: [filme, canal, filme, { nope: 1 }],
    history: [canal],
    progress: { m1: { p: 1200.4, d: 5400, t: 1000 }, ruim: { p: "x" } },
  });
  assert.deepEqual(saved.body.favorites.map((f) => f.id), ["m1", "c1"]);
  assert.equal(saved.body.favorites[0].hack, undefined);
  assert.ok(saved.body.favorites_t > 0);
  assert.deepEqual(saved.body.progress, { m1: { p: 1200, d: 5400, t: 1000 } });

  // Aparelho 2 (outra sessao, mesma conta): ve tudo e continua de onde parou
  cookie = "";
  await call("POST", "/api/player/login", { username: "edu", password: "pw" });
  const other = (await call("GET", "/api/player/sync")).body;
  assert.deepEqual(other.favorites.map((f) => f.id), ["m1", "c1"]);
  assert.deepEqual(other.history.map((f) => f.id), ["c1"]);
  assert.equal(other.progress.m1.p, 1200);

  // Progresso mais antigo nao sobrescreve o mais novo; lista nova substitui; merge junta
  const next = await call("PUT", "/api/player/sync", { favorites: [canal], progress: { m1: { p: 10, d: 5400, t: 500 }, m2: { p: 60, d: 100, t: 2000 } } });
  assert.deepEqual(next.body.favorites.map((f) => f.id), ["c1"]);
  assert.equal(next.body.progress.m1.p, 1200);
  assert.equal(next.body.progress.m2.p, 60);
  const merged = await call("PUT", "/api/player/sync", { merge: true, favorites: [filme, canal] });
  assert.deepEqual(merged.body.favorites.map((f) => f.id), ["c1", "m1"]);

  // Cliente apagado: some a sincronizacao junto
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const edu = (await call("GET", "/api/clients")).body.find((c) => c.username === "edu");
  await call("DELETE", `/api/clients/${edu.id}`);
  const { getStore } = await import("./store/index.js");
  assert.equal(await getStore().sync.get(edu.id), null);
});

test("perfis: cada perfil tem seus favoritos, historico e progresso; dados antigos ficam no principal", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  await call("POST", "/api/clients", { name: "Familia Silva", username: "fam", password: "pw" });
  const filme = { id: "m1", name: "Filme", group: "Acao", logo: "", src: "http://a/1.mp4", type: "file", kind: "movie", epg_id: "", playlist_id: "own", alt: "", alt_type: "" };

  cookie = "";
  assert.equal((await call("GET", "/api/player/profiles")).status, 401);
  await call("POST", "/api/player/login", { username: "fam", password: "pw" });
  // Conta que ja sincronizava (sem ?profile=): os dados ficam no perfil principal
  await call("PUT", "/api/player/sync", { favorites: [filme], progress: { m1: { p: 100, d: 5400, t: 1 } } });
  const start = (await call("GET", "/api/player/profiles")).body;
  assert.deepEqual(start.profiles, [{ id: "main", name: "Familia Silva", avatar: 0, kids: false }]);
  assert.equal((await call("GET", "/api/player/sync?profile=main")).body.favorites[0].id, "m1");

  const kids = await call("POST", "/api/player/profiles", { name: "  Crianças  ", avatar: 5, kids: true });
  assert.equal(kids.status, 200);
  assert.deepEqual({ ...kids.body, id: undefined }, { id: undefined, name: "Crianças", avatar: 5, kids: true });
  assert.equal((await call("POST", "/api/player/profiles", { name: "" })).status, 400);

  // Perfil novo comeca vazio e nao mexe no principal
  const pid = kids.body.id;
  assert.deepEqual((await call("GET", `/api/player/sync?profile=${pid}`)).body.favorites, []);
  await call("PUT", `/api/player/sync?profile=${pid}`, { history: [filme], progress: { m1: { p: 50, d: 5400, t: 2 } } });
  const main = (await call("GET", "/api/player/sync?profile=main")).body;
  assert.equal(main.progress.m1.p, 100);
  assert.deepEqual(main.history, []);
  assert.equal((await call("GET", "/api/player/sync?profile=nao-existe")).status, 404);

  const edited = await call("PUT", `/api/player/profiles/${pid}`, { name: "Kids", avatar: 99 });
  assert.deepEqual({ name: edited.body.name, avatar: edited.body.avatar, kids: edited.body.kids }, { name: "Kids", avatar: 5, kids: true });

  for (let i = 0; i < 3; i++) assert.equal((await call("POST", "/api/player/profiles", { name: `P${i}` })).status, 200);
  assert.equal((await call("POST", "/api/player/profiles", { name: "Sexto" })).status, 400);

  // Apagar perfil apaga os dados dele; o ultimo perfil nao pode ser apagado
  assert.equal((await call("DELETE", `/api/player/profiles/${pid}`)).status, 200);
  const { getStore } = await import("./store/index.js");
  const fam = (await getStore().clients.findOne("username", "fam"));
  assert.equal(await getStore().sync.get(`${fam.id}__${pid}`), null);
  const rest = (await call("GET", "/api/player/profiles")).body.profiles;
  assert.equal(rest.length, 4);
  for (const p of rest.slice(1)) await call("DELETE", `/api/player/profiles/${p.id}`);
  assert.equal((await call("DELETE", "/api/player/profiles/main")).status, 400);

  // Cliente apagado: somem os perfis junto
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  await call("DELETE", `/api/clients/${fam.id}`);
  assert.equal(await getStore().profiles.get(fam.id), null);
});

test("renova links expirados do historico, so os do proprio cliente", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const port = source.address().port;
  await call("POST", "/api/clients", { username: "hist", password: "pw", source: { kind: "m3u_url", url: `http://127.0.0.1:${port}/hls.m3u` } });
  await call("POST", "/api/clients", { username: "outro", password: "pw", source: { kind: "m3u_url", url: `http://127.0.0.1:${port}/hls.m3u` } });
  cookie = "";
  await call("POST", "/api/player/login", { username: "hist", password: "pw" });

  // Link gerado "ha 13 horas" (relogio do servidor atrasado) = link guardado no historico de ontem
  const realNow = Date.now;
  Date.now = () => realNow() - 13 * 3600 * 1000;
  let old;
  try {
    old = (await call("GET", "/api/player/channels")).body.channels.find((c) => c.kind === "live").src;
  } finally {
    Date.now = realNow;
  }
  assert.equal((await call("GET", old)).status, 403, "link de ontem esta expirado");

  const [fresh, tampered, direct] = (
    await call("POST", "/api/player/resign", { urls: [old, old.replace(/([?&]s=)[^&]+/, "$1xxxx"), "http://direto.com/a.ts"] })
  ).body.urls;
  assert.notEqual(fresh, old);
  assert.equal((await call("GET", fresh)).status, 200, "link renovado volta a tocar");
  assert.equal(tampered, "", "link adulterado nao e renovado");
  assert.equal(direct, "http://direto.com/a.ts", "link direto volta igual");

  // outro cliente nao consegue renovar o link deste
  cookie = "";
  await call("POST", "/api/player/login", { username: "outro", password: "pw" });
  assert.equal((await call("POST", "/api/player/resign", { urls: [old] })).body.urls[0], "");
});

test("ordenacao do catalogo: alfabetica, adicionados, ano e nota", async () => {
  cookie = "";
  await call("POST", "/api/player/login", { username: "TiaX", password: "Sen@1" });
  const names = async (q) => (await call("GET", `/api/player/xtream/items?section=movie&${q}`)).body;
  const paged = async (sort) => (await names(`limit=10&sort=${sort}`)).items.map((m) => m.name);
  assert.deepEqual(await paged(""), ["Filme Teste", "Abelha Rainha", "Zebra (1999)"], "padrao = ordem do fornecedor");
  assert.deepEqual(await paged("az"), ["Abelha Rainha", "Filme Teste", "Zebra (1999)"]);
  assert.deepEqual(await paged("za"), ["Zebra (1999)", "Filme Teste", "Abelha Rainha"]);
  assert.deepEqual(await paged("recent"), ["Abelha Rainha", "Filme Teste", "Zebra (1999)"]);
  assert.deepEqual(await paged("oldest"), ["Zebra (1999)", "Filme Teste", "Abelha Rainha"]);
  assert.deepEqual(await paged("year_desc"), ["Abelha Rainha", "Filme Teste", "Zebra (1999)"], "ano do release_date e do nome");
  assert.deepEqual(await paged("rating"), ["Zebra (1999)", "Abelha Rainha", "Filme Teste"], "nota de 5 estrelas vira 0-10");
  // por categoria (sem paginas) tambem ordena, e o ano/nota vao para o reprodutor
  const cat = await names("category=20&sort=year_asc");
  assert.deepEqual(cat.map((m) => [m.name, m.year]), [["Zebra (1999)", 1999], ["Filme Teste", 2015], ["Abelha Rainha", 2023]]);
  assert.equal(cat[2].rating, 8.4);
});

test("ficha do filme e da serie vem do fornecedor", async () => {
  cookie = "";
  await call("POST", "/api/player/login", { username: "TiaX", password: "Sen@1" });
  const movies = (await call("GET", "/api/player/xtream/items?section=movie&category=20")).body;
  const abelha = movies.find((m) => m.name === "Abelha Rainha");
  assert.equal(abelha.xt_id, "51", "o filme leva o id do fornecedor para buscar a ficha");
  const info = (await call("GET", `/api/player/info?kind=movie&id=${abelha.xt_id}&name=Abelha%20Rainha`)).body;
  assert.deepEqual(info.genres, ["Acao", "Suspense"]);
  assert.deepEqual(info.cast, ["Ana Lima", "Rui Costa"]);
  assert.deepEqual(info.director, ["Joao Silva"]);
  assert.equal(info.year, 2023);
  assert.equal(info.minutes, 112);
  assert.equal(info.trailer, "https://www.youtube.com/watch?v=abcDEF12345");
  assert.equal(info.poster, "https://img.example/a.jpg");
  assert.match(info.backdrop, /^\/api\/player\/proxy\?/, "imagem http passa pelo servidor");
  assert.equal(info.tmdb_id, undefined);
  const serie = (await call("GET", "/api/player/info?kind=series&id=70&name=Serie%20Teste&year=2020")).body;
  assert.equal(serie.name, "Serie Teste");
  assert.equal(serie.seasons, 1);
  assert.equal(serie.year, 2020);
  // "T1" no card: temporadas de varias series de uma vez, contadas pelos episodios
  const seasons = (await call("GET", "/api/player/xtream/seasons?ids=70,72,70")).body;
  assert.deepEqual(seasons, { 70: 1, 72: 1 });
  // sem id (lista M3U): so o nome, sem erro
  const m3u = await call("GET", "/api/player/info?kind=movie&name=Qualquer");
  assert.equal(m3u.status, 200);
  assert.equal(m3u.body.name, "Qualquer");
});

test("limpa o nome do titulo para buscar na internet", async () => {
  const { cleanTitle } = await import("./titleinfo.js");
  assert.equal(cleanTitle("BR: Abelha Rainha (2023) [4K]"), "Abelha Rainha");
  assert.equal(cleanTitle("Duna - Parte Dois 2024"), "Duna - Parte Dois");
  assert.equal(cleanTitle("Oppenheimer - Dublado"), "Oppenheimer");
});

test("filtros do catalogo: genero, ano e nota", async () => {
  cookie = "";
  await call("POST", "/api/player/login", { username: "TiaX", password: "Sen@1" });
  const names = async (q) => (await call("GET", `/api/player/xtream/items?section=movie&limit=10&sort=az&${q}`)).body.items.map((m) => m.name);
  assert.deepEqual(await names("g=Acao"), ["Filme Teste", "Zebra (1999)"], "sem genero do fornecedor, vale o da categoria");
  assert.deepEqual(await names("g=suspense,comedia"), ["Abelha Rainha"], "sem diferenca de maiusculas/acentos; qualquer um dos generos");
  assert.deepEqual(await names("y1=2010"), ["Abelha Rainha", "Filme Teste"]);
  assert.deepEqual(await names("y2=2000"), ["Zebra (1999)"]);
  assert.deepEqual(await names("r=8"), ["Abelha Rainha", "Zebra (1999)"]);
  assert.deepEqual(await names("g=acao&y1=2000&r=6"), ["Filme Teste"]);
  const byCat = (await call("GET", "/api/player/xtream/items?section=movie&category=20&r=8")).body;
  assert.equal(byCat.length, 2, "filtra tambem dentro de uma categoria");
  assert.deepEqual(byCat.find((m) => m.name === "Abelha Rainha").genres, ["Suspense", "Drama"]);
  const facets = (await call("GET", "/api/player/xtream/facets?section=movie")).body;
  assert.deepEqual(facets.genres.map((g) => [g.name, g.count]), [["Acao", 2], ["Drama", 1], ["Suspense", 1]]);
  assert.deepEqual(facets.years, { min: 1999, max: 2023 });
  assert.equal(facets.rated, 3);
});

test("recomendacoes: pontua genero, direcao, elenco, ano e nota", async () => {
  const { similarity, rankSimilar, normGenre, genresInText } = await import("./recommend.js");
  assert.equal(normGenre("Ação"), "acao");
  assert.equal(normGenre("Science Fiction"), "ficcao cientifica");
  assert.deepEqual(genresInText("FILMES | TERROR E SUSPENSE").sort(), ["suspense", "terror"]);

  const alvo = { id: "1", name: "Duna (2021) [4K]", genres: ["Ficção científica", "Aventura"], director: ["Denis Villeneuve"], cast: ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson"], year: 2021, rating: 7.8 };
  const cands = [
    { id: "2", name: "Duna - Parte Dois", genres: ["Science Fiction", "Adventure"], director: ["Denis Villeneuve"], cast: ["Timothée Chalamet", "Zendaya"], year: 2024, rating: 8.3 },
    { id: "3", name: "A Chegada", genres: ["Drama", "Science Fiction"], director: ["Denis Villeneuve"], cast: ["Amy Adams"], year: 2016, rating: 7.6 },
    { id: "4", name: "Interestelar", genres: ["Ficção Científica", "Aventura", "Drama"], director: ["Christopher Nolan"], cast: [], year: 2014, rating: 8.4 },
    { id: "5", name: "Comedia Qualquer", genres: ["Comédia"], director: ["Fulano"], cast: [], year: 1995, rating: 5 },
    { id: "6", name: "Duna 2021 - Legendado", genres: ["Ficção científica"], year: 2021 }, // outra versao do mesmo filme
    { id: "7", name: "Sem Ficha", category: "Filmes | Ficcao Cientifica", year: 2020, rating: 7 },
  ];
  const top = rankSimilar(alvo, cands, { minScore: 2 });
  assert.deepEqual(top.map((t) => t.id), ["2", "3", "4", "7"], "continuacao > mesmo diretor > mesmo genero > so pela categoria; comedia fora");
  assert.ok(!top.some((t) => t.id === "6"), "outra versao do mesmo titulo nao e recomendada");
  assert.equal(top[0].reasons[0], "Da mesma franquia");
  assert.ok(top[1].reasons.includes("Direção de Denis Villeneuve"));
  assert.ok(similarity(alvo, { name: "X", cast: ["Zendaya"] }).reasons.includes("Com Zendaya"));
  // nota maior desempata titulos parecidos
  const a = similarity(alvo, { name: "A", genres: ["Aventura"], year: 2020, rating: 8.5 }).score;
  const b = similarity(alvo, { name: "B", genres: ["Aventura"], year: 2020, rating: 5.5 }).score;
  assert.ok(a > b);

  cookie = "";
  await call("POST", "/api/player/login", { username: "TiaX", password: "Sen@1" });
  const recs = (await call("GET", "/api/player/recommend?kind=movie&id=51&name=Abelha%20Rainha")).body;
  assert.deepEqual(recs.map((r) => r.name), ["Filme Teste"], "mesmo diretor e genero (da ficha do fornecedor); comedia fica de fora");
  assert.equal(recs[0].xt_id, "50");
  assert.ok(recs[0].reasons.includes("Direção de Joao Silva"));
  assert.deepEqual((await call("GET", "/api/player/recommend?kind=movie&id=51&name=Abelha%20Rainha&skip=20")).body, [], "pula categorias bloqueadas");
  assert.deepEqual((await call("GET", "/api/player/recommend?kind=movie&name=Qualquer")).body, [], "sem id (lista M3U): vazio");
});

test("validade automatica pela lista do fornecedor", async () => {
  const port = source.address().port;
  const xt = { kind: "xtream", xtream_server: `http://127.0.0.1:${port}`, xtream_username: "Renova", xtream_password: "pw" };
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  renova = "active";
  const created = await call("POST", "/api/clients", { username: "renova", password: "pw", source: xt, expires_at: "2000-01-01T00:00:00Z" });
  assert.equal(created.body.list_status.state, "active");
  assert.equal(created.body.expires_at, "2030-01-01T00:00:00.000Z", "vencimento vem do fornecedor, nao do painel");
  assert.equal(created.body.valid, true);

  // Venceu no fornecedor: login mostra a tela de lista expirada
  renova = "expired";
  cookie = "";
  const login = await call("POST", "/api/player/login", { username: "renova", password: "pw" });
  assert.equal(login.status, 403);
  assert.equal(login.body.code, "list_expired");
  assert.match(login.body.error, /Lista expirada/);
  assert.equal((await call("GET", "/api/player/channels")).body.code, "list_expired");

  // Fornecedor fora do ar: nao muda o resultado anterior
  renova = "down";
  assert.equal((await call("GET", "/api/player/me?recheck=1")).body.code, "list_expired");

  // Renovou: ao abrir o app libera sozinho, sem novo login
  renova = "active";
  const me = await call("GET", "/api/player/me?recheck=1");
  assert.equal(me.status, 200);
  assert.equal(me.body.username, "renova");
  renova = "down";
  assert.equal((await call("GET", "/api/player/me?recheck=1")).status, 200, "queda do fornecedor nao bloqueia");

  // Painel: status de cada cliente e conferencia manual
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  renova = "expired";
  const checked = await call("POST", `/api/clients/${created.body.id}/check`);
  assert.equal(checked.body.list_status.state, "expired");
  assert.equal(checked.body.valid, false);
  assert.ok((await call("GET", "/api/stats")).body.expired_clients >= 1);
  renova = "active";
});

test("trocar servidor: os clientes marcados passam para o servidor novo e mantem usuario e senha", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const old = "http://127.0.0.9:1";
  const novo = `http://127.0.0.1:${source.address().port}`;
  const a = (
    await call("POST", "/api/clients", {
      username: "srvA",
      password: "a1",
      source: { kind: "xtream", xtream_server: `${old}/`, xtream_username: "TiaX", xtream_password: "Sen@1", epg_url: `${old}/xmltv.php?username=TiaX&password=Sen@1` },
      extra_sources: [{ kind: "m3u_url", url: "http://outro.example/lista.m3u" }],
    })
  ).body;
  const b = (await call("POST", "/api/clients", { username: "srvB", password: "b1", source: { kind: "m3u_url", url: "http://127.0.0.8:8080/get.php?username=Bia&password=B%402&type=m3u_plus" } })).body;
  const c = (await call("POST", "/api/clients", { username: "srvC", password: "c1", source: { kind: "m3u_url", url: `${old}/c.m3u` } })).body;

  assert.equal((await call("POST", "/api/servers/replace", { link: "nao e link", client_ids: [a.id] })).status, 400);
  assert.equal((await call("POST", "/api/servers/replace", { link: `${novo}/get.php` })).status, 400, "sem cliente marcado");
  const done = await call("POST", "/api/servers/replace", { link: `${novo}/get.php?username=Modelo&password=M1&type=m3u_plus&output=ts`, client_ids: [a.id] });
  assert.equal(done.status, 200);
  assert.equal(done.body.clients, 1);
  // Clientes de servidores diferentes no mesmo pedido; servidor novo na porta padrao (a porta antiga nao sobra).
  await call("POST", "/api/servers/replace", { link: "http://novo.exemplo:80/get.php?username=x&password=y", client_ids: [b.id] });

  const all = (await call("GET", "/api/clients")).body;
  const get = (id) => all.find((x) => x.id === id);
  assert.equal(get(a.id).source.xtream_server, novo);
  assert.equal(get(a.id).source.xtream_username, "TiaX", "usuario do fornecedor continua o mesmo");
  assert.equal(get(a.id).source.xtream_password, "Sen@1");
  assert.equal(get(a.id).source.epg_url, `${novo}/xmltv.php?username=TiaX&password=Sen@1`);
  assert.equal(get(a.id).extra_sources[0].url, "http://outro.example/lista.m3u", "lista extra de outro fornecedor nao muda");
  assert.equal(get(b.id).source.url, "http://novo.exemplo/get.php?username=Bia&password=B%402&type=m3u_plus");
  assert.equal(get(c.id).source.url, `${old}/c.m3u`, "cliente nao marcado continua no servidor antigo");
  assert.equal(get(a.id).username, "srvA");
  assert.equal(get(a.id).password, "a1", "login do cliente no RTec continua o mesmo");

  // O cliente ja assiste pelo servidor novo.
  cookie = "";
  await call("POST", "/api/player/login", { username: "srvA", password: "a1" });
  const live = (await call("GET", "/api/player/xtream/items?section=live")).body;
  assert.deepEqual(live.map((x) => x.name), ["ESPN", "Canal +18"], "catalogo vem do servidor novo");
});

test("sessoes: cookie do cliente nao abre o painel; trocar a senha do admin derruba as outras sessoes", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const adminCookie = cookie;
  await call("POST", "/api/clients", { username: "sess1", password: "pw" });
  cookie = "";
  await call("POST", "/api/player/login", { username: "sess1", password: "pw" });
  const playerToken = cookie.split("=")[1];

  // O token do cliente (mesmo segredo) nao serve como cookie de administrador, nem o do admin como de cliente.
  cookie = `rtec_session=${playerToken}`;
  assert.equal((await call("GET", "/api/clients")).status, 401);
  cookie = `rtec_player=${adminCookie.split("=")[1]}`;
  assert.equal((await call("GET", "/api/player/me")).status, 401);

  // Token antigo do reprodutor (sem "typ") continua valendo; token antigo do painel (sem "typ") nao.
  const jwt = (await import("jsonwebtoken")).default;
  const payload = JSON.parse(Buffer.from(playerToken.split(".")[1], "base64url"));
  const { getStore } = await import("./store/index.js");
  const secret = await getStore().getOrCreateSecret(() => "nao-usado");
  cookie = `rtec_player=${jwt.sign({ cid: payload.cid, pw: payload.pw }, secret)}`;
  assert.equal((await call("GET", "/api/player/me")).status, 200);
  const admin = await getStore().admins.findOne("username", "admin");
  cookie = `rtec_session=${jwt.sign({ id: admin.id, username: "admin" }, secret)}`;
  assert.equal((await call("GET", "/api/clients")).status, 401);

  // Duas sessoes do painel; a troca de senha numa derruba a outra.
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const other = cookie;
  cookie = adminCookie;
  assert.equal((await call("POST", "/api/auth/password", { current: "secret123", next: "curta" })).status, 400);
  assert.equal((await call("POST", "/api/auth/password", { current: "secret123", next: "senha-nova-forte" })).status, 200);
  assert.equal((await call("GET", "/api/clients")).status, 200, "a sessao que trocou a senha continua");
  cookie = other;
  assert.equal((await call("GET", "/api/clients")).status, 401);

  const bcrypt = (await import("bcryptjs")).default;
  await getStore().admins.update(admin.id, { password_hash: bcrypt.hashSync("secret123", 4) });
});

test("PIN parental: muitos erros seguidos travam o PIN por um tempo", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  await call("POST", "/api/clients", { username: "pin1", password: "pw" });
  cookie = "";
  await call("POST", "/api/player/login", { username: "pin1", password: "pw" });
  let tries = 0;
  while ((await call("POST", "/api/player/pin/verify", { pin: String(1000 + tries) })).status === 403) tries++;
  assert.ok(tries <= 8);
  assert.equal((await call("POST", "/api/player/pin/verify", { pin: "0000" })).status, 429);
});

// Por ultimo: depois deste teste o endereco local fica bloqueado para login de admin por 15 minutos.
test("muitas senhas erradas seguidas: o login espera um pouco", async () => {
  cookie = "";
  let tries = 0;
  while ((await call("POST", "/api/auth/login", { username: "admin", password: `chute${tries}` })).status === 401) tries++;
  assert.ok(tries <= 8, "bloqueia em no maximo 8 erros");
  const blocked = await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Aguarde/);
});
