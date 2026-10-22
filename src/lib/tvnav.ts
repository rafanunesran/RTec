/**
 * Navegacao pelo controle remoto (TV Samsung/Tizen, LG, Android TV e TV Box).
 * Setas movem o foco para o botao mais proximo naquela direcao, OK clica, Voltar desfaz um passo
 * e as teclas de midia (play/pause, avancar, voltar) agem no video aberto.
 */
import { isNativeApp } from "./pwa";

const TV_UA = /Tizen|SMART-TV|SmartTV|Web0S|webOS|NetCast|BRAVIA|HbbTV|VIDAA|Android TV|GoogleTV|AFT[A-Z]/i;

let tvMode = false;
let tvScreen = false;

/** O site esta rodando numa TV (ou com ?tv=1 para testar no computador). */
export function isTV() {
  if (TV_UA.test(navigator.userAgent)) return true;
  try {
    const q = new URLSearchParams(location.search).get("tv");
    if (q !== null) localStorage.setItem("rtec:tv", q === "0" ? "0" : "1");
    return localStorage.getItem("rtec:tv") === "1";
  } catch {
    return false;
  }
}

/** Dentro do app da Samsung (pacote .wgt, ver tizen/). */
export const isTizen = () => /Tizen/i.test(navigator.userAgent);

type Tizen = {
  tvinputdevice?: { registerKeyBatch?: (keys: string[], ok?: () => void, err?: () => void) => void };
  application?: { getCurrentApplication: () => { exit: () => void } };
};
const tizen = () => (window as unknown as { tizen?: Tizen }).tizen;

// Codigos das teclas do controle (Tizen usa keyCode; outros navegadores mandam e.key).
const KEY = {
  left: [37],
  up: [38],
  right: [39],
  down: [40],
  enter: [13],
  back: [10009, 461, 8], // Tizen, LG webOS, Backspace
  playPause: [10252, 179],
  play: [415],
  pause: [19],
  stop: [413],
  forward: [417, 228],
  rewind: [412, 227],
  channelUp: [427],
  channelDown: [428],
  reload: [403], // botao vermelho (A)
};
const NAMES: Record<string, keyof typeof KEY> = {
  ArrowLeft: "left",
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowDown: "down",
  Left: "left",
  Up: "up",
  Right: "right",
  Down: "down",
  Enter: "enter",
  GoBack: "back",
  BrowserBack: "back",
  MediaPlayPause: "playPause",
  MediaPlay: "play",
  MediaPause: "pause",
  MediaStop: "stop",
  MediaFastForward: "forward",
  MediaRewind: "rewind",
  MediaTrackNext: "forward",
  MediaTrackPrevious: "rewind",
  ChannelUp: "channelUp",
  ChannelDown: "channelDown",
  ColorF0Red: "reload",
};

function keyOf(e: KeyboardEvent): keyof typeof KEY | null {
  if (e.key && NAMES[e.key]) return NAMES[e.key];
  for (const k of Object.keys(KEY) as (keyof typeof KEY)[]) if (KEY[k].includes(e.keyCode)) return k;
  return null;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isText = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(button|checkbox|radio|range|submit|reset|file|color)$/i.test((el as HTMLInputElement).type)));

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none";
}

/**
 * Camada de cima: o foco fica preso no dialogo, menu, ficha do titulo ou player aberto.
 * Telas marcadas com data-tv-scope="N" (N = prioridade, como o z-index); dialogos valem 60.
 */
function topScope(): HTMLElement {
  let best: HTMLElement = document.body;
  let bestZ = -1;
  document.querySelectorAll<HTMLElement>('[role="dialog"], [data-tv-scope]').forEach((el) => {
    if (!visible(el)) return;
    const z = el.dataset.tvScope ? Number(el.dataset.tvScope) : 60;
    if (z >= bestZ) {
      best = el;
      bestZ = z;
    }
  });
  return best;
}

const candidates = (scope: HTMLElement) =>
  Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tagName !== "VIDEO" && visible(el));

type Dir = "left" | "right" | "up" | "down";

/** Melhor vizinho na direcao: perto no eixo principal e alinhado no outro eixo. */
function nearest(from: DOMRect, list: HTMLElement[], dir: Dir, self?: HTMLElement) {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === self || el.contains(self ?? null)) continue;
    const r = el.getBoundingClientRect();
    let main: number;
    let cross: number;
    if (dir === "right" || dir === "left") {
      main = dir === "right" ? r.left - from.right : from.left - r.right;
      if (main < -from.width / 2) continue;
      const overlap = Math.min(r.bottom, from.bottom) - Math.max(r.top, from.top);
      cross = overlap > 0 ? 0 : Math.abs(r.top + r.height / 2 - cy);
    } else {
      main = dir === "down" ? r.top - from.bottom : from.top - r.bottom;
      if (main < -from.height / 2) continue;
      const overlap = Math.min(r.right, from.right) - Math.max(r.left, from.left);
      cross = overlap > 0 ? 0 : Math.abs(r.left + r.width / 2 - cx);
    }
    const score = Math.max(main, 0) + cross * 3;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

// Ultimo item selecionado em cada camada: ao fechar um dialogo, o foco volta para onde estava.
const lastFocus = new WeakMap<HTMLElement, HTMLElement>();

/**
 * Na TV, focar um campo de texto ja abre o teclado na tela. O campo fica so leitura enquanto
 * o foco passa por ele e libera a digitacao quando o usuario aperta OK.
 */
function lockText(el: HTMLElement) {
  if (!tvScreen || !isText(el) || el.readOnly) return;
  el.readOnly = true;
  el.dataset.tvLocked = "1";
  el.addEventListener("blur", () => unlockText(el), { once: true });
}
function unlockText(el: HTMLInputElement | HTMLTextAreaElement) {
  if (el.dataset.tvLocked !== "1") return false;
  delete el.dataset.tvLocked;
  el.readOnly = false;
  return true;
}

function focusEl(el: HTMLElement, scope: HTMLElement) {
  lastFocus.set(scope, el);
  lockText(el);
  el.focus({ preventScroll: true });
  // Na TV o item escolhido fica no meio da tela, como nos apps de streaming; no celular so o necessario.
  const opts: ScrollIntoViewOptions = { block: tvScreen ? "center" : "nearest", inline: "nearest" };
  if ("scrollBehavior" in document.documentElement.style) el.scrollIntoView(opts);
  else (el as HTMLElement & { scrollIntoViewIfNeeded?: (center?: boolean) => void }).scrollIntoViewIfNeeded?.(false);
}

/** Primeiro item da tela: o mais acima e a esquerda. */
function first(list: HTMLElement[]) {
  const inView = list.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  });
  return (inView.length ? inView : list).sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return Math.round(ra.top - rb.top) || ra.left - rb.left;
  })[0];
}

function videoIn(scope: HTMLElement) {
  return scope.querySelector("video");
}

function media(video: HTMLVideoElement, k: keyof typeof KEY) {
  const vod = Number.isFinite(video.duration) && video.duration > 0;
  const seek = (s: number) => vod && (video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + s)));
  if (k === "playPause" || k === "enter") void (video.paused ? video.play().catch(() => {}) : video.pause());
  else if (k === "play") void video.play().catch(() => {});
  else if (k === "pause") video.pause();
  else if (k === "forward" || k === "right") seek(k === "right" ? 10 : 30);
  else if (k === "rewind" || k === "left") seek(k === "left" ? -10 : -30);
  else return false;
  return true;
}

/**
 * A lista nativa (<select>) nao abre pelo controle na TV: mostra as opcoes numa janela propria
 * e repassa a escolha para o <select> (o React recebe o "change" normalmente).
 */
function openSelect(select: HTMLSelectElement) {
  const box = document.createElement("div");
  box.setAttribute("role", "dialog");
  box.className = "fixed inset-0 z-[70] flex items-center justify-center bg-background/80 backdrop-blur-sm";
  const list = document.createElement("div");
  list.className = "flex max-h-[80vh] w-[28rem] max-w-[90vw] flex-col gap-1 overflow-y-auto rounded-2xl border bg-card p-3 shadow-2xl";
  const title = select.getAttribute("aria-label");
  if (title) {
    const h = document.createElement("div");
    h.className = "px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground";
    h.textContent = title;
    list.appendChild(h);
  }
  const close = () => {
    window.removeEventListener("keydown", onEsc);
    box.remove();
    select.focus({ preventScroll: true });
  };
  const onEsc = (e: KeyboardEvent) => e.key === "Escape" && close();
  let current: HTMLButtonElement | null = null;
  Array.from(select.options).forEach((o) => {
    if (o.disabled) return;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = o.text;
    const on = o.value === select.value;
    b.className = "flex h-12 w-full items-center rounded-lg px-4 text-left font-semibold " + (on ? "bg-primary/15 text-foreground" : "text-muted-foreground");
    b.addEventListener("click", () => {
      if (o.value !== select.value) {
        // Setter nativo: sem ele o React nao percebe a troca de valor.
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, o.value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      close();
    });
    if (on) current = b;
    list.appendChild(b);
  });
  box.appendChild(list);
  box.addEventListener("click", (e) => e.target === box && close());
  window.addEventListener("keydown", onEsc);
  document.body.appendChild(box);
  const f = current ?? list.querySelector("button");
  if (f) focusEl(f, box);
}

function back() {
  const scope = topScope();
  // Dialogos e menus fecham com Esc; telas cheias (ficha, player) deixaram um passo no historico.
  if (scope.getAttribute("role") === "dialog" || scope.dataset.tvClose === "escape") {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return;
  }
  if (history.state && (history.state.rtecNav || history.state.rtecPlayer)) {
    history.back();
    return;
  }
  // Ja esta no Inicio: a tela avisa (o player volta para a escolha de perfil); se ninguem tratar, sai do app.
  if (!window.dispatchEvent(new CustomEvent("rtec:back-home", { cancelable: true }))) return;
  try {
    tizen()?.application?.getCurrentApplication().exit();
  } catch {
    /* fora do app da Samsung nao ha o que fazer */
  }
}

function onKey(e: KeyboardEvent) {
  const k = keyOf(e);
  if (!k || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const active = document.activeElement as HTMLElement | null;

  if (k === "back") {
    if (e.keyCode === 8 && isText(active)) return; // Backspace apagando texto
    e.preventDefault();
    if (isText(active)) active.blur();
    else back();
    return;
  }

  const scope = topScope();
  const focused = active && active !== document.body && scope.contains(active) ? active : null;
  const video = videoIn(scope);

  // Botao vermelho: recarrega o site (pega a versao nova sem fechar o app da TV).
  if (k === "reload") {
    e.preventDefault();
    location.reload();
    return;
  }

  // CH+/CH-: proximo/anterior canal ou episodio (o player escuta o evento).
  if (k === "channelUp" || k === "channelDown") {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("rtec:channel", { detail: k === "channelUp" ? 1 : -1 }));
    return;
  }

  if (k !== "left" && k !== "right" && k !== "up" && k !== "down" && k !== "enter") {
    const v = video ?? document.querySelector("video");
    if (v && media(v, k)) e.preventDefault();
    return;
  }

  if (k === "enter") {
    if (focused) {
      if (isText(focused)) {
        // Primeiro OK no campo: libera a digitacao e abre o teclado da TV; depois, envia o formulario.
        if (unlockText(focused)) {
          e.preventDefault();
          focused.blur();
          focused.focus();
        }
        return;
      }
      e.preventDefault();
      if (focused instanceof HTMLSelectElement) openSelect(focused);
      else focused.click();
    } else if (video) {
      e.preventDefault();
      media(video, k);
    }
    return;
  }

  // No texto, esquerda/direita andam no cursor.
  if (isText(focused) && (k === "left" || k === "right")) {
    const pos = focused.selectionStart;
    const atEdge = pos === null || (k === "left" ? pos === 0 : pos === focused.value.length);
    if (!atEdge) return;
  }
  // Barra de volume/tempo: deixa o navegador mover o valor.
  if (focused instanceof HTMLInputElement && focused.type === "range" && (k === "left" || k === "right")) return;

  e.preventDefault();
  const list = candidates(scope);
  if (!focused) {
    // Player aberto e nada selecionado: esquerda/direita avancam ou voltam o video.
    if (video && (k === "left" || k === "right")) {
      media(video, k);
      return;
    }
    const last = lastFocus.get(scope);
    const f = last && list.includes(last) ? last : first(list);
    if (f) focusEl(f, scope);
    return;
  }
  // Menus em coluna (data-tv-group, ex: menu lateral): para cima/baixo continua dentro do menu,
  // mesmo que o catalogo atras esteja mais perto na tela; no fim do menu, o foco fica parado.
  const group = k === "up" || k === "down" ? focused.closest<HTMLElement>("[data-tv-group]") : null;
  const inGroup = group ? nearest(focused.getBoundingClientRect(), list.filter((el) => group.contains(el)), k, focused) : null;
  const next = group ? inGroup : nearest(focused.getBoundingClientRect(), list, k, focused);
  if (next) focusEl(next, scope);
  else if (video) focused.blur(); // sai dos botoes e volta a controlar o video
  else if (k === "up") scrollTo({ top: 0 });
}

/** Liga a navegacao por controle remoto quando o site roda numa TV ou no app. */
export function setupTvNavigation() {
  tvScreen = isTV();
  tvMode = tvScreen || isNativeApp();
  if (!tvMode) return;
  document.documentElement.classList.add("tv-nav");
  // Tela grande vista de longe: tudo maior e layout de TV (ver index.css e Player).
  if (tvScreen) document.documentElement.classList.add("tv-screen");
  try {
    // Sem registrar, o Tizen nao entrega as teclas de midia para a pagina.
    tizen()?.tvinputdevice?.registerKeyBatch?.(["MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop", "MediaFastForward", "MediaRewind", "ChannelUp", "ChannelDown", "ColorF0Red"]);
  } catch {
    /* fora do Tizen */
  }
  window.addEventListener("keydown", onKey);
}

export const tvNavigationOn = () => tvMode;

/** Layout de TV (tela grande, controle remoto). */
export const tvScreenOn = () => tvScreen;
