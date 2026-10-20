// RTec - servidor de video (proxy) para rodar numa VPS, ex: Oracle Cloud "Always Free".
// Repassa os streams do fornecedor para o reprodutor web, sem o limite de banda/tempo da Vercel.
// Aceita so links assinados pelo painel (mesmo PROXY_SECRET configurado na Vercel), com validade.
// Uso: PROXY_SECRET=... PORT=8080 node server.mjs   (sem dependencias; Node 18+)
import http from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";

const SECRET = process.env.PROXY_SECRET;
const PORT = Number(process.env.PORT || 8080);
const UA = "VLC/3.0.20 LibVLC/3.0.20";
const TTL_SECONDS = 12 * 3600;
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

function link(c, u) {
  const e = Math.ceil((Date.now() / 1000 + TTL_SECONDS) / 3600) * 3600;
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  if (url.pathname === "/health") return send(res, 200, "ok");
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS" });
    return res.end();
  }
  if (url.pathname !== "/api/player/proxy") return send(res, 404, "not found");
  const { u, c, e, s } = Object.fromEntries(url.searchParams);
  if (!/^https?:\/\//i.test(u || "") || !valid(c, e, u, s)) return send(res, 403, "Link invalido ou expirado");

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

server.listen(PORT, () => console.log(`[proxy] RTec video rodando na porta ${PORT}`));
