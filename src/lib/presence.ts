// "Estou aberto": a cada minuto o reprodutor avisa o servidor de video (Oracle) que o app esta aberto e se
// tem video na tela. O Painel do admin mostra quantos clientes e telas estao usando agora. Fica so na memoria
// do servidor de video (nada no banco). Com a aba escondida e sem video, para de avisar e sai da conta.
const EVERY_MS = 60_000;

let link = "";
let timer: ReturnType<typeof setInterval> | null = null;
let watching = 0;

function send(extra = "") {
  if (!link) return;
  if (document.hidden && !watching && !extra) return;
  // Imagem em vez de fetch: funciona ate nos navegadores de TV mais antigos e nao precisa de resposta.
  const img = new Image();
  img.src = `${link}&w=${watching ? 1 : 0}${extra}&t=${Date.now().toString(36)}`;
}

const onVisible = () => {
  if (!document.hidden) send();
};
// Aba ou app fechando: avisa na hora (sendBeacon chega mesmo com a pagina saindo).
const onHide = () => {
  if (!link) return;
  const url = `${link}&x=1`;
  try {
    if (navigator.sendBeacon?.(url)) return;
  } catch {
    /* navegador antigo */
  }
  send("&x=1");
};

export function startPresence(url: string | undefined) {
  stopPresence();
  if (!url) return;
  link = url;
  send();
  timer = setInterval(send, EVERY_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onHide);
}

export function stopPresence() {
  onHide();
  link = "";
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("pagehide", onHide);
}

/** O VideoPlayer avisa quando abre e fecha (conta como tela em uso). */
export function setWatching(on: boolean) {
  const was = watching > 0;
  watching = Math.max(0, watching + (on ? 1 : -1));
  if (was !== watching > 0) send();
}
