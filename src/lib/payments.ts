/** Pagamento previsto do cliente (data AAAA-MM-DD combinada com ele). */

/** Hoje no aparelho do admin, como AAAA-MM-DD. */
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Dias ate o pagamento (0 = hoje, negativo = atrasado). */
export function daysUntil(due: string, today = todayStr()) {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

/** 08/11 (ou 08/11/2027 quando for de outro ano). */
export function shortDate(due: string, today = todayStr()) {
  const [y, m, d] = due.split("-");
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}

/** Quantos dias antes o painel ja mostra o pagamento em "A cobrar". */
export const SOON_DAYS = 3;

export function dueLabel(due: string, today = todayStr()) {
  const n = daysUntil(due, today);
  if (n === 0) return { text: "Cobrar hoje", tone: "warning" as const };
  if (n < 0) return { text: n === -1 ? "Atrasado 1 dia" : `Atrasado ${-n} dias`, tone: "danger" as const };
  if (n === 1) return { text: "Amanhã", tone: "info" as const };
  if (n <= SOON_DAYS) return { text: `Em ${n} dias`, tone: "info" as const };
  return { text: shortDate(due, today), tone: "muted" as const };
}
