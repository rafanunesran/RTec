import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.ADMIN_PASSWORD = "secret123";
process.env.PROXY_CHUNK_MB = "1"; // testa a entrega de filmes em pedacos (como na Vercel)

const { setStore } = await import("./store/index.js");
const { createMemoryStore } = await import("./store/memory.js");
const { createFirestoreStore } = await import("./store/firestore.js");
const { createApp, ensureAdminAccount } = await import("./app.js");
// Com FIRESTORE_EMULATOR_HOST (npm run test:firestore) os mesmos testes rodam no Firestore de verdade.
setStore(process.env.FIRESTORE_EMULATOR_HOST ? createFirestoreStore() : createMemoryStore());

let api, source, base, cookie = "";

const SOURCE_M3U = '#EXTM3U\n#EXTINF:-1 tvg-logo="x.png" group-title="Noticias",Canal Remoto\nhttp://example.com/remoto.ts\n';
const HLS = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:4,\nseg/1.ts\n";

const MOVIE = Buffer.alloc(3 * 1024 * 1024, 7);
const b64 = (t) => Buffer.from(t).toString("base64");

function xtreamApi(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
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
      return json([{ category_id: "30", category_name: "Series | Drama" }]);
    case "get_live_streams":
      return json(
        [
          { stream_id: 1, name: "ESPN", stream_icon: `http://127.0.0.1:${port}/logo.png`, category_id: "10" },
          { stream_id: 2, name: "Canal +18", stream_icon: "", category_id: "11" },
        ].filter((x) => !q.get("category_id") || x.category_id === q.get("category_id")),
      );
    case "get_vod_streams":
      return json([{ stream_id: 50, name: "Filme Teste", stream_icon: "https://img.example/f.jpg", container_extension: "mp4", category_id: "20" }]);
    case "get_series":
      return json([{ series_id: 70, name: "Serie Teste", cover: "https://img.example/s.jpg", category_id: "30" }]);
    case "get_series_info":
      return json({ info: {}, episodes: { 1: [{ id: 902, episode_num: 2, season: 1, title: "Ep 2", container_extension: "mkv" }, { id: 901, episode_num: 1, season: 1, title: "Ep 1", container_extension: "mp4" }] } });
    case "get_short_epg": {
      const now = Math.floor(Date.now() / 1000);
      return json({ epg_listings: [{ title: b64("Jogo ao vivo"), description: b64("Final"), start_timestamp: now - 600, stop_timestamp: now + 600 }] });
    }
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
  assert.match(lines[1], /URI="\/api\/player\/proxy\?u=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Flive%2Fkey\.bin&c=\w+&e=\d+&s=/);
  const segment = await call("GET", lines[3]);
  assert.equal(segment.body, "TSDATA");

  const tampered = ch.src.replace("index.m3u8", "outro.m3u8");
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

test("lista propria do cliente: colar no cadastro, testar e assistir", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const port = source.address().port;
  const src = { kind: "m3u_url", url: `http://127.0.0.1:${port}/hls.m3u`, playback: "proxy" };

  const preview = await call("POST", "/api/source/preview", src);
  assert.equal(preview.body.ok, true);
  assert.deepEqual(preview.body.kinds, { live: 1, movie: 1, series: 1 });
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
  const m3u = await call("GET", `/m3u/${client.body.token}.m3u`);
  assert.match(m3u.body, /Canal HLS/);

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
  const empty = await check("erro2", { kind: "m3u_url", url: `http://127.0.0.1:${port}/vazia.m3u` });
  assert.match(empty.errors[0], /lista vazia/);
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

  const movies = (await call("GET", "/api/player/xtream/items?section=movie&category=20")).body;
  assert.equal(movies[0].logo, "https://img.example/f.jpg", "logo https vai direto");
  assert.equal((await call("GET", "/api/player/xtream/items?section=movie")).status, 400);
  const allMovies = (await call("GET", "/api/player/xtream/items?section=movie&limit=10&q=teste")).body;
  assert.equal(allMovies.total, 1, "Todos: catalogo inteiro em paginas, com busca");
  assert.equal(allMovies.items[0].name, "Filme Teste");
  assert.equal((await call("GET", "/api/player/xtream/items?section=movie&limit=10&skip=20")).body.total, 0, "pula categorias bloqueadas");

  // Filme pelo proxy: entregue em pedacos de 1 MB
  const first = await fetch(base + movies[0].src, { headers: { cookie, range: "bytes=0-" } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get("content-range"), `bytes 0-1048575/${MOVIE.length}`);
  assert.equal((await first.arrayBuffer()).byteLength, 1048576);

  const series = (await call("GET", "/api/player/xtream/items?section=series&category=30")).body;
  assert.equal(series[0].series_id, "70");
  const eps = (await call("GET", "/api/player/xtream/series/70?name=Serie%20Teste")).body;
  assert.deepEqual(eps.map((e) => [e.name, e.season, e.episode]), [["Ep 1", 1, 1], ["Ep 2", 1, 2]]);
  assert.equal(eps[0].parent_series, "70");
  const acc = (await call("GET", "/api/player/xtream/items?section=movie&limit=10&q=TESTE")).body;
  assert.equal(acc.items[0].name, "Filme Teste", "busca ignora maiusculas/acentos");
  assert.match(decodeURIComponent(eps[1].src), /\/series\/TiaX\/Sen%401\/902\.mkv/);

  const epg = (await call("GET", "/api/player/epg?ids=xt:1")).body;
  assert.equal(epg["xt:1"][0].title, "Jogo ao vivo");
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
test("renova links expirados do historico, so os do proprio cliente", async () => {
  cookie = "";
  await call("POST", "/api/auth/login", { username: "admin", password: "secret123" });
  const port = source.address().port;
  await call("POST", "/api/clients", { username: "hist", password: "pw", source: { kind: "m3u_url", url: `http://127.0.0.1:${port}/hls.m3u` } });
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
  await call("POST", "/api/player/login", { username: "edu", password: "pw" });
  assert.equal((await call("POST", "/api/player/resign", { urls: [old] })).body.urls[0], "");
});
