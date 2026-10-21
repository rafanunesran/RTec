// Confere se a lista do cliente (M3U ou Xtream) ainda da acesso, sem confiar numa data digitada a mao.
// "active": o fornecedor liberou; "expired": recusou, venceu ou esta bloqueada;
// "unknown": nao deu para saber (fornecedor fora do ar, demorou, erro 5xx). Nesse caso vale o ultimo resultado.
import { xtreamCredentials } from "./xtream.js";

const PLAYER_UA = "VLC/3.0.20 LibVLC/3.0.20";
const TIMEOUT_MS = Number(process.env.LIST_CHECK_TIMEOUT_SECONDS || 8) * 1000;
const PEEK_BYTES = 64 * 1024;

const unknown = (reason) => ({ state: "unknown", reason });
const expired = (reason, extra = {}) => ({ state: "expired", reason, ...extra });
const looksHtml = (s) => /^\s*</.test(s);

async function get(url) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": PLAYER_UA, Accept: "*/*" } });
  } catch (err) {
    return { error: err.name === "TimeoutError" ? "O fornecedor demorou demais para responder" : "Nao foi possivel conectar no fornecedor" };
  }
}

/** Le so o comeco da resposta (listas M3U grandes passam de 70 MB). */
async function peek(res) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < PEEK_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } catch {
    // corte no meio: analisa o que chegou
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Xtream: a conta do fornecedor diz o status (Active/Expired/Banned...) e a data de vencimento (exp_date). */
async function checkXtream(creds) {
  const q = new URLSearchParams({ username: creds.username, password: creds.password });
  const res = await get(`${creds.server}/player_api.php?${q}`);
  if (res.error) return unknown(res.error);
  const text = await peek(res);
  if (res.status >= 500 || res.status === 429) return unknown(`O fornecedor respondeu com erro HTTP ${res.status}`);
  if (looksHtml(text)) return unknown("O fornecedor respondeu com uma pagina em vez da conta");
  if (res.status === 401 || res.status === 403) return expired("O fornecedor recusou o usuario/senha da lista");
  if (!res.ok) return unknown(`O fornecedor respondeu com erro HTTP ${res.status}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return unknown("O fornecedor nao respondeu no formato Xtream");
  }
  const u = data?.user_info;
  if (!u || Number(u.auth) === 0) return expired("O fornecedor recusou o usuario/senha da lista");
  const exp = Number(u.exp_date);
  const expires_at = exp > 0 ? new Date(exp * 1000).toISOString() : null;
  const status = String(u.status || "");
  if (status && !/^active$/i.test(status)) return expired(`Conta no fornecedor: ${status}`, { expires_at, provider_status: status });
  if (exp > 0 && exp * 1000 <= Date.now()) return expired("A lista venceu no fornecedor", { expires_at, provider_status: status });
  return { state: "active", reason: "", expires_at, provider_status: status || "Active" };
}

/** Link M3U comum: precisa abrir e trazer canais (#EXTINF). */
async function checkM3u(url) {
  const res = await get(url);
  if (res.error) return unknown(res.error);
  if (res.status >= 500 || res.status === 429) {
    res.body?.cancel().catch(() => {});
    return unknown(`O servidor da lista respondeu com erro HTTP ${res.status}`);
  }
  const text = await peek(res);
  if (!res.ok) return expired(`O servidor da lista recusou o acesso (HTTP ${res.status})`);
  if (/#EXTINF/i.test(text)) return { state: "active", reason: "" };
  if (looksHtml(text)) return unknown("O link abriu uma pagina, nao uma lista M3U");
  return expired(text.trim() ? "O link nao trouxe mais canais" : "O fornecedor retornou a lista vazia");
}

/** null quando nao ha o que conferir (sem lista propria ou lista colada). */
export async function checkSource(source) {
  if (!source?.kind || source.kind === "manual") return null;
  const creds = xtreamCredentials(source);
  if (creds) return checkXtream(creds);
  if (source.kind === "m3u_url" && source.url) return checkM3u(source.url);
  return null;
}

