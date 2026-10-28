// RTec - servidor de video (proxy) para rodar numa VPS, ex: Oracle Cloud "Always Free".
// Repassa os streams do fornecedor para o reprodutor web, sem o limite de banda/tempo da Vercel.
// Aceita so links assinados pelo painel (mesmo PROXY_SECRET configurado na Vercel), com validade.
// Uso: PROXY_SECRET=... PORT=8080 node server.mjs   (sem dependencias; Node 18+)
import http from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";

const SECRET = process.env.PROXY_SECRET;
const PORT = Number(process.env.PORT || 8080);
// So o Caddy (https, na mesma maquina) fala com este servidor: a porta em http nao fica aberta para a internet.
const HOST = process.env.HOST || "127.0.0.1";
const UA = "VLC/3.0.20 LibVLC/3.0.20";
const TTL_SECONDS = 12 * 3600;
// Canais com audio Dolby (AC-3) ficam mudos no navegador: /api/player/aac troca so o audio por AAC com o
// ffmpeg (a imagem passa sem mexer, gasta pouco processador). Limite de conversoes ao mesmo tempo.
const MAX_AAC = Number(process.env.MAX_AAC || 8);
let aacRunning = 0;
if (!SECRET) {
  console.error("Defina PROXY_SECRET (o mesmo valor configurado na Vercel).");
  process.exit(1);
}

const sign = (c, e, u) => crypto.createHmac("sha256", SECRET).update(`${c}|${e}|${u}`).digest("base64url").slice(0, 32);

function valid(c, e, u, s) {
  if (!c || !(Number(e) > Date.now() / 1000)) return false;
  const a = Buffer.from(sign(c, e, u));
  const b = Buffer.from(String(s || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// O link do fornecedor viaja cifrado (AES-256-GCM, mesmo formato de server/seal.js no painel).
const URL_KEY = crypto.createHash("sha256").update(`rtec-url-v1|${SECRET}`).digest();

function seal(url) {
  const iv = crypto.createHmac("sha256", URL_KEY).update(url).digest().subarray(0, 12);
  const c = crypto.createCipheriv("aes-256-gcm", URL_KEY, iv);
  const ct = Buffer.concat([c.update(url, "utf8"), c.final()]);
  return `x${Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64url")}`;
}

function open(token) {
  if (/^https?:\/\//i.test(token)) return token; // link antigo, sem cifra
  if (!/^x[\w-]{40,}$/.test(token)) return "";
  try {
    const raw = Buffer.from(token.slice(1), "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", URL_KEY, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function link(c, url) {
  const e = Math.ceil((Date.now() / 1000 + TTL_SECONDS) / 3600) * 3600;
  const u = seal(url);
  return `/api/player/proxy?${new URLSearchParams({ u, c, e: String(e), s: sign(c, e, u) })}`;
}

/** Reescreve playlists HLS para que segmentos e chaves tambem passem por aqui. */
function rewriteHls(text, baseUrl, c) {
  const abs = (u) => new URL(u, baseUrl).toString();
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${link(c, abs(u))}"`);
      return link(c, abs(t));
    })
    .join("\n");
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

/** Repassa o canal com o audio convertido para AAC (MPEG-TS continuo, para o mpegts.js). */
function aac(u, req, res) {
  if (aacRunning >= MAX_AAC) return send(res, 503, "Muitas conversoes de audio ao mesmo tempo");
  // Link HLS o ffmpeg ja acompanha sozinho; MPEG-TS continuo precisa reconectar se o fornecedor cortar.
  const input = /\.m3u8$/i.test(new URL(u).pathname) ? [] : ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"];
  const ff = spawn(
    "ffmpeg",
    [
      "-loglevel", "error", "-nostdin",
      "-user_agent", UA,
      "-protocol_whitelist", "http,https,tcp,tls,crypto",
      ...input,
      "-probesize", "2000000", "-analyzeduration", "2000000", // comeca a tocar mais rapido
      "-i", u,
      "-map", "0:v:0?", "-map", "0:a:0",
      "-c:v", "copy", "-c:a", "aac", "-ac", "2", "-b:a", "160k",
      "-f", "mpegts", "-muxdelay", "0", "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  aacRunning++;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    aacRunning--;
    ff.kill("SIGKILL");
  };
  ff.on("error", (err) => {
    console.warn(`[aac] ffmpeg nao abriu: ${err.message}`);
    stop();
    if (!res.headersSent) send(res, 500, "ffmpeg nao instalado");
    else res.end();
  });
  ff.stderr.on("data", (d) => console.warn(`[aac] ${new URL(u).host}: ${String(d).trim().slice(0, 300)}`));
  ff.stdout.once("data", () => res.headersSent || res.writeHead(200, { "Content-Type": "video/mp2t", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" }));
  ff.stdout.pipe(res);
  ff.on("close", () => {
    stop();
    if (!res.headersSent) send(res, 502, "Nao consegui abrir o canal para converter o audio");
    else res.end();
  });
  req.on("close", stop);
  res.on("close", stop);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  if (url.pathname === "/health") return send(res, 200, "ok");
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS" });
    return res.end();
  }
  if (url.pathname !== "/api/player/proxy" && url.pathname !== "/api/player/aac") return send(res, 404, "not found");
  const { c, e, s } = Object.fromEntries(url.searchParams);
  const token = url.searchParams.get("u") || "";
  const u = valid(c, e, token, s) ? open(token) : "";
  if (!/^https?:\/\//i.test(u)) return send(res, 403, "Link invalido ou expirado");
  if (url.pathname === "/api/player/aac") return aac(u, req, res);

  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const headers = { "User-Agent": UA };
  if (req.headers.range) headers.Range = req.headers.range;
  let upstream;
  try {
    upstream = await fetch(u, { headers, signal: controller.signal, redirect: "follow" });
  } catch (err) {
    if (!controller.signal.aborted) console.warn(`[proxy] falha ao conectar em ${new URL(u).host}: ${err.cause?.code || err.message}`);
    return res.headersSent ? res.end() : send(res, 502, "Falha ao conectar na fonte");
  }
  if (!upstream.ok) console.warn(`[proxy] fornecedor respondeu HTTP ${upstream.status} para ${new URL(u).host}`);
  const type = upstream.headers.get("content-type") || "";
  if (/mpegurl/i.test(type) || /\.m3u8$/i.test(new URL(upstream.url).pathname)) {
    const text = await upstream.text();
    res.writeHead(upstream.status, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(rewriteHls(text, upstream.url, c));
  }
  const out = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges" };
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) out[h] = v;
  }
  res.writeHead(upstream.status, out);
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).on("error", () => res.end()).pipe(res);
});

server.listen(PORT, HOST, () => console.log(`[proxy] RTec video rodando na porta ${PORT}`));
