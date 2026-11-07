import { ApiError } from "@/lib/api";

/**
 * Nome do servidor para mostrar: "srv.com:8080". Em https o "https://" fica visivel, para
 * http://srv.com e https://srv.com nao parecerem o mesmo servidor na tela.
 */
export const serverLabel = (origin: string) => (/^https:\/\//i.test(origin) ? origin : origin.replace(/^http:\/\//i, ""));

/**
 * Salva pedindo confirmacao quando o servidor da lista repete o nome de um que ja existe
 * (o painel avisa com o codigo server_duplicate). Devolve null se o admin cancelou.
 */
export async function withDuplicateCheck<T>(send: (allow: boolean) => Promise<T>): Promise<T | null> {
  try {
    return await send(false);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "server_duplicate") throw err;
    if (!window.confirm(`${err.message}\n\nSalvar mesmo assim, com um servidor novo?`)) return null;
    return send(true);
  }
}
