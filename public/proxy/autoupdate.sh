#!/usr/bin/env bash
# RTec - atualizacao automatica do servidor de video (Oracle).
#
# A cada 15 min confere no GitHub (branch main) se o server.mjs mudou. Se mudou:
#   - instala o que faltar na maquina (pacotes de packages.txt, ex: ffmpeg);
#   - confere se o arquivo novo e um JavaScript valido;
#   - espera ninguem estar assistindo pelo servidor (no maximo 6 h; de madrugada aplica mesmo assim);
#   - troca o arquivo e reinicia; se o servidor nao responder, volta a versao anterior.
# O proprio script tambem se atualiza, entao novas configuracoes chegam sozinhas.
#
# Instalar (uma vez, na maquina):  curl -fsSL .../public/proxy/autoupdate.sh | sudo bash -s -- install
# Ver a situacao:                  sudo rtec-update status
# Atualizar agora:                 sudo rtec-update now
set -euo pipefail

SRC="${RTEC_UPDATE_SRC:-https://raw.githubusercontent.com/rafanunesran/RTec/main/public/proxy}"
APP="${RTEC_UPDATE_APP:-/opt/rtec-proxy/server.mjs}"
DIR="${RTEC_UPDATE_DIR:-/var/lib/rtec-update}"
LOG="${RTEC_UPDATE_LOG:-/var/log/rtec-update.log}"
MAX_WAIT=$((6 * 3600))

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
fetch() { curl -fsSL --max-time 60 "$SRC/$1?t=$(date +%s)" -o "$2"; }

port() {
  local p
  p="$(sed -n 's/^PORT=//p' "${RTEC_UPDATE_ENV:-/etc/rtec-proxy.env}" 2>/dev/null | tail -1)"
  echo "${p:-8080}"
}

# Videos passando pelo servidor agora (versao antiga sem essa conta: 0).
viewers() {
  local n
  n="$(curl -fsS --max-time 3 "http://127.0.0.1:$(port)/active" 2>/dev/null || true)"
  [[ "$n" =~ ^[0-9]+$ ]] && echo "$n" || echo 0
}

healthy() {
  for _ in $(seq 1 15); do
    curl -fsS --max-time 3 "http://127.0.0.1:$(port)/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

packages() {
  local list missing=()
  list="$(mktemp)"
  fetch packages.txt "$list" 2>/dev/null || { rm -f "$list"; return 0; }
  while read -r p; do
    p="${p%%#*}"; p="$(echo "$p" | tr -d '[:space:]')"
    [ -n "$p" ] && ! dpkg -s "$p" >/dev/null 2>&1 && missing+=("$p")
  done < "$list"
  rm -f "$list"
  if [ "${#missing[@]}" -gt 0 ]; then
    log "Instalando: ${missing[*]}"
    DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}" >/dev/null
  fi
}

self_update() {
  local tmp
  tmp="$(mktemp)"
  if fetch autoupdate.sh "$tmp" 2>/dev/null && bash -n "$tmp" && grep -q "rtec-update" "$tmp" && ! cmp -s "$tmp" /usr/local/bin/rtec-update; then
    install -m 755 "$tmp" /usr/local/bin/rtec-update
    log "Script de atualizacao renovado (vale a partir da proxima verificacao)."
  fi
  rm -f "$tmp"
}

cmd_check() {
  local force="${1:-}" tmp now since hour
  mkdir -p "$DIR"
  tmp="$DIR/server.new.mjs"
  if ! fetch server.mjs "$tmp"; then
    log "Nao consegui baixar o server.mjs do GitHub (tento de novo depois)."
    return 0
  fi
  if cmp -s "$tmp" "$APP"; then
    rm -f "$tmp" "$DIR/pending_since"
    self_update
    return 0
  fi
  if ! node --check "$tmp" 2>/dev/null; then
    log "Versao nova com erro de sintaxe: ignorada."
    return 0
  fi
  now="$(date +%s)"
  [ -f "$DIR/pending_since" ] || echo "$now" > "$DIR/pending_since"
  since="$(cat "$DIR/pending_since")"
  hour="$(TZ=America/Sao_Paulo date +%H)"
  if [ -z "$force" ] && [ "$(viewers)" -gt 0 ] && [ $((now - since)) -lt "$MAX_WAIT" ] && [ "$hour" -ge 6 ]; then
    log "Versao nova pronta; esperando terminar $(viewers) conexao(oes) de video para reiniciar."
    return 0
  fi
  packages
  cp -f "$APP" "$DIR/server.mjs.bak" 2>/dev/null || true
  install -m 644 "$tmp" "$APP"
  systemctl restart rtec-proxy
  if healthy; then
    log "Servidor de video atualizado."
    rm -f "$tmp" "$DIR/pending_since"
  else
    log "Servidor nao respondeu com a versao nova: voltando a anterior."
    [ -f "$DIR/server.mjs.bak" ] && install -m 644 "$DIR/server.mjs.bak" "$APP"
    systemctl restart rtec-proxy
    # Nao tenta de novo a mesma versao com problema.
    cp -f "$tmp" "$DIR/server.mjs.bad"
  fi
  self_update
}

cmd_status() {
  echo "Proxima verificacao: $(systemctl list-timers rtec-update.timer --no-legend 2>/dev/null | awk '{print $1, $2, $3}')"
  echo "Conexoes de video agora: $(viewers)"
  echo "Ultimos registros:"
  tail -n 8 "$LOG" 2>/dev/null || echo "  (nenhum ainda)"
}

cmd_install() {
  [ "$(id -u)" = 0 ] || { echo "Rode com sudo"; exit 1; }
  if [ -f "$0" ] && grep -q "rtec-update" "$0"; then
    install -m 755 "$0" /usr/local/bin/rtec-update
  else
    curl -fsSL "$SRC/autoupdate.sh" -o /usr/local/bin/rtec-update
    chmod 755 /usr/local/bin/rtec-update
  fi
  cat > /etc/systemd/system/rtec-update.service <<'UNIT'
[Unit]
Description=RTec: confere e aplica atualizacao do servidor de video
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/rtec-update check
UNIT
  cat > /etc/systemd/system/rtec-update.timer <<'UNIT'
[Unit]
Description=RTec: confere atualizacao do servidor de video a cada 15 minutos
[Timer]
OnBootSec=3min
OnUnitActiveSec=15min
RandomizedDelaySec=60
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now rtec-update.timer
  /usr/local/bin/rtec-update now || true
  echo
  echo "Atualizacao automatica ligada: a cada 15 min o servidor confere o GitHub e se atualiza sozinho."
  echo "Ver a situacao a qualquer momento:  sudo rtec-update status"
}

case "${1:-install}" in
  check)
    # Versao que ja falhou na verificacao de saude: so tenta de novo quando sair outra.
    if [ -f "$DIR/server.mjs.bad" ] && curl -fsSL --max-time 60 "$SRC/server.mjs" 2>/dev/null | cmp -s - "$DIR/server.mjs.bad"; then exit 0; fi
    cmd_check
    ;;
  now) cmd_check force ;;
  status) cmd_status ;;
  install) cmd_install ;;
  *) echo "Uso: rtec-update {install|check|now|status}"; exit 1 ;;
esac
