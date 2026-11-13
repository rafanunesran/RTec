// Service worker do RTec: guarda o "esqueleto" do app para abrir rapido e funcionar como app instalado.
// Nunca guarda respostas da API nem os streams de video (os downloads offline ficam no IndexedDB do app).
const CACHE = "rtec-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/favicon.svg"];

/** Guarda os arquivos do app (js/css) citados na pagina: o app abre sem internet (downloads offline). */
function cacheAssets(html) {
  const assets = [...new Set(html.match(/\/assets\/[\w.-]+\.(?:js|css)/g) || [])];
  return caches.open(CACHE).then((c) => Promise.all(assets.map((a) => c.match(a).then((hit) => hit || c.add(a)))));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL).then(() => c.match("/")))
      .then((res) => res && res.text().then(cacheAssets))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/m3u/") || url.pathname === "/get.php") return;

  // Paginas: rede primeiro, cache se estiver offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // So guarda paginas HTML (o link /apk e um download, nao pode virar a pagina inicial offline).
          if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy));
            res.clone().text().then(cacheAssets).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Arquivos estaticos (js, css, icones): cache primeiro.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
