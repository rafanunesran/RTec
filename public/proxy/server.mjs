// RTec - servidor de video (proxy) para rodar numa VPS, ex: Oracle Cloud "Always Free".
// Repassa os streams do fornecedor para o reprodutor web, sem o limite de banda/tempo da Vercel.
// Aceita so links assinados pelo painel (mesmo PROXY_SECRET configurado na Vercel), com validade.
// Uso: PROXY_SECRET=... PORT=8080 node server.mjs   (sem dependencias; Node 18+)
import http from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

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
let streaming = 0;
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!SECRET && isMain) {
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

// ---------- Pular intro / Proximo EP: abertura e creditos achados pelo audio ----------
// A abertura (e a musica dos creditos) se repete em todos os episodios de uma temporada. O ffmpeg tira a
// "impressao digital" do audio (chromaprint) do comeco e do fim de dois episodios e aqui se procura o trecho
// que toca igual nos dois. Cada episodio fica com a posicao e o tamanho dele (nada fixo por serie).
// Roda um episodio por vez (uma conexao a mais no fornecedor) e o painel guarda o resultado no banco.
const FP_STEP = 0.1238; // segundos por ponto do chromaprint
const FP_BITS = 6; // dois pontos "tocam igual" com ate 6 bits diferentes (de 32)
const FP_GAP = 3.5; // buraco tolerado dentro do mesmo trecho (s)
const INTRO_MIN = 15;
const INTRO_MAX = 180;
const CREDITS_MIN = 15;
// Sobra depois dos creditos maior que isso: cena pos-creditos (o botao Proximo EP nao aparece nos creditos).
const POST_MIN = 20;
const HEAD_MAX = 600; // abertura: ate 10 min do comeco (no maximo 1/4 do episodio)
const TAIL_MAX = 420; // creditos: ate 7 min do fim
const MARKS_TIMEOUT_MS = 4 * 60 * 1000;
const MAX_MARK_JOBS = Number(process.env.MAX_MARK_JOBS || 30);

const popcount = (x) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
};

/** Trechos em que a e b tocam o mesmo som: { a, b, len } em pontos, para os deslocamentos mais provaveis. */
export function matchRuns(a, b, minSec) {
  const index = new Map();
  for (let j = 0; j < b.length; j++) {
    const l = index.get(b[j]);
    if (!l) index.set(b[j], [j]);
    else if (l.length < 8) l.push(j);
  }
  const votes = new Map();
  for (let i = 0; i < a.length; i++) for (const j of index.get(a[i]) || []) votes.set(j - i, (votes.get(j - i) || 0) + 1);
  const shifts = [...votes].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]).slice(0, 300);
  const gap = Math.round(FP_GAP / FP_STEP);
  const min = Math.round(minSec / FP_STEP);
  const runs = [];
  for (const [shift] of shifts) {
    let start = -1;
    let last = -1;
    const flush = () => start >= 0 && last - start + 1 >= min && runs.push({ a: start, b: start + shift, len: last - start + 1 });
    for (let i = Math.max(0, -shift), end = Math.min(a.length, b.length - shift); i < end; i++) {
      if (popcount(a[i] ^ b[i + shift]) > FP_BITS) continue;
      if (start >= 0 && i - last > gap) {
        flush();
        start = -1;
      }
      if (start < 0) start = i;
      last = i;
    }
    flush();
  }
  return runs;
}

const sec = (pts) => Math.round(pts * FP_STEP * 10) / 10;

/** Abertura nos dois comecos: o maior trecho igual com tamanho de abertura. [[ini, fim] de a, [ini, fim] de b] */
export function findIntro(a, b) {
  const best = matchRuns(a, b, INTRO_MIN)
    .filter((r) => r.len * FP_STEP <= INTRO_MAX)
    .sort((x, y) => y.len - x.len)[0];
  return best ? [[sec(best.a), sec(best.a + best.len)], [sec(best.b), sec(best.b + best.len)]] : null;
}

/**
 * Creditos nos dois finais. O ultimo bloco de som igual e o comeco dos creditos; se depois dele ainda ha mais
 * de POST_MIN segundos diferentes nos dois, e cena pos-creditos (ou previa), e o botao fica so para o fim.
 * Devolve [{ at, post } de a, { at, post } de b] com "at" em segundos dentro do pedaco analisado.
 */
export function findCredits(a, b) {
  const runs = matchRuns(a, b, 8);
  const side = (key, total) => {
    const spans = runs.map((r) => [r[key], r[key] + r.len]).sort((x, y) => x[0] - y[0]);
    const gap = Math.round(FP_GAP / FP_STEP);
    const blocks = [];
    for (const s of spans) {
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock && s[0] - lastBlock[1] <= gap) lastBlock[1] = Math.max(lastBlock[1], s[1]);
      else blocks.push([...s]);
    }
    const final = blocks.filter((x) => (x[1] - x[0]) * FP_STEP >= CREDITS_MIN).pop();
    if (!final) return null;
    return { at: sec(final[0]), post: (total - final[1]) * FP_STEP > POST_MIN };
  };
  const ma = side("a", a.length);
  const mb = side("b", b.length);
  return ma && mb ? [ma, mb] : null;
}

function run(cmd, args, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), MARKS_TIMEOUT_MS);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-400)));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      if (code !== 0 && !buf.length) return reject(new Error(err.trim() || `${cmd} saiu com ${code}`));
      resolve(binary ? buf : buf.toString("utf8"));
    });
  });
}

const netArgs = ["-user_agent", UA, "-protocol_whitelist", "http,https,tcp,tls,crypto,file"];

async function duration(u) {
  const out = await run("ffprobe", ["-v", "error", ...netArgs, "-show_entries", "format=duration", "-of", "csv=p=0", u]).catch(() => "");
  return Number(String(out).trim()) || 0;
}

async function fingerprint(u, from, len) {
  const buf = await run(
    "ffmpeg",
    ["-loglevel", "error", "-nostdin", ...netArgs, ...(from > 0 ? ["-ss", String(from)] : []), "-i", u, "-t", String(Math.round(len)), "-map", "0:a:0", "-ac", "1", "-f", "chromaprint", "-fp_format", "raw", "pipe:1"],
    { binary: true },
  );
  const pts = new Uint32Array(Math.floor(buf.length / 4));
  for (let i = 0; i < pts.length; i++) pts[i] = buf.readUInt32LE(i * 4);
  return pts;
}

/** Impressao do comeco e do fim de um episodio. */
async function episodePrint(u) {
  const dur = await duration(u);
  const head = await fingerprint(u, 0, dur ? Math.min(HEAD_MAX, dur / 4) : HEAD_MAX);
  if (head.length < 50) throw new Error("Sem audio no episodio");
  let tail = null;
  let tailFrom = 0;
  if (dur > 300) {
    const len = Math.min(TAIL_MAX, dur * 0.3);
    tailFrom = Math.max(0, dur - len);
    tail = await fingerprint(u, tailFrom, len).catch(() => null);
  }
  return { dur, head, tail, tailFrom };
}

/** Compara dois episodios e completa o que faltava em ma/mb (abertura, creditos). */
function compare(A, B, ma, mb) {
  if (!ma.intro || !mb.intro) {
    const intro = findIntro(A.head, B.head);
    if (intro) {
      ma.intro ||= intro[0];
      mb.intro ||= intro[1];
    }
  }
  if ((ma.credits == null || mb.credits == null) && A.tail && B.tail) {
    const cr = findCredits(A.tail, B.tail);
    if (cr) {
      if (ma.credits == null) Object.assign(ma, { credits: Math.round((A.tailFrom + cr[0].at) * 10) / 10, post: cr[0].post });
      if (mb.credits == null) Object.assign(mb, { credits: Math.round((B.tailFrom + cr[1].at) * 10) / 10, post: cr[1].post });
    }
  }
}

/** urls[0]: episodio pedido; urls[1]: vizinho; urls[2] (opcional): outro vizinho, so se faltar algo. */
export async function analyzeEpisodes(urls, printer = episodePrint) {
  const empty = (p) => ({ intro: null, credits: null, post: false, dur: Math.round(p?.dur || 0) });
  const A = await printer(urls[0]);
  const out = [empty(A)];
  for (let k = 1; k < urls.length; k++) {
    if (k > 1 && out[0].intro && out[0].credits != null) break;
    const B = await printer(urls[k]).catch((err) => {
      console.warn(`[marcas] episodio vizinho falhou: ${err.message}`);
      return null;
    });
    out[k] = empty(B);
    if (B) compare(A, B, out[0], out[k]);
  }
  return out;
}

const markJobs = new Map(); // chave -> { status, eps, error, at }
const markQueue = [];
let markBusy = false;

async function pumpMarks() {
  if (markBusy) return;
  const job = markQueue.shift();
  if (!job) return;
  markBusy = true;
  try {
    job.state.eps = await analyzeEpisodes(job.urls);
    job.state.status = "done";
  } catch (err) {
    job.state.status = "error";
    job.state.error = String(err.message || err).slice(0, 200);
    console.warn(`[marcas] falhou: ${job.state.error}`);
  }
  job.state.at = Date.now();
  markBusy = false;
  setImmediate(pumpMarks);
}

/** /api/player/marks?u=<link1~link2~link3>&c&e&s: comeca a analise e responde na hora (pending/done/error). */
function marksRoute(url, res) {
  const { c, e, s } = Object.fromEntries(url.searchParams);
  const token = url.searchParams.get("u") || "";
  const urls = valid(c, e, token, s) ? token.split("~").map(open) : [];
  if (urls.length < 2 || urls.length > 3 || !urls.every((u) => /^https?:\/\//i.test(u))) return send(res, 403, "Link invalido ou expirado");
  const key = crypto.createHash("sha1").update(urls.join("|")).digest("hex");
  for (const [k, j] of markJobs) if (j.at && Date.now() - j.at > 6 * 3600 * 1000) markJobs.delete(k);
  let state = markJobs.get(key);
  if (!state || (state.status === "error" && Date.now() - state.at > 10 * 60 * 1000)) {
    if (markQueue.length >= MAX_MARK_JOBS) return json(res, 503, { status: "busy" });
    state = { status: "pending" };
    markJobs.set(key, state);
    markQueue.push({ urls, state });
    pumpMarks();
  }
  json(res, 200, { status: state.status, ...(state.eps ? { eps: state.eps } : {}), ...(state.error ? { error: state.error } : {}) });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  if (url.pathname === "/health") return send(res, 200, "ok");
  // Quantos videos passam por aqui agora (a atualizacao automatica espera chegar a 0 para reiniciar).
  // So para quem esta na propria maquina (o que vem da internet passa pelo Caddy, com X-Forwarded-For).
  if (url.pathname === "/active" && !req.headers["x-forwarded-for"]) return send(res, 200, String(streaming));
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS" });
    return res.end();
  }
  if (url.pathname === "/api/player/marks") return marksRoute(url, res);
  if (url.pathname !== "/api/player/proxy" && url.pathname !== "/api/player/aac") return send(res, 404, "not found");
  const { c, e, s } = Object.fromEntries(url.searchParams);
  const token = url.searchParams.get("u") || "";
  const u = valid(c, e, token, s) ? open(token) : "";
  if (!/^https?:\/\//i.test(u)) return send(res, 403, "Link invalido ou expirado");
  streaming++;
  res.once("close", () => streaming--);
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

if (isMain) server.listen(PORT, HOST, () => console.log(`[proxy] RTec video rodando na porta ${PORT}`));
