#!/usr/bin/env bash
# RTec - vigia de atividade da maquina gratis da Oracle.
#
# A Oracle recolhe instancias Always Free quando, em 7 dias, o 95o percentil de uso de CPU fica abaixo de 20%,
# ou seja: basta a maquina passar de 20% durante ~5% do tempo (~8,4 h por semana) para nao ser recolhida.
#
# O vigia:
#   - a cada 10 min anota o uso de CPU (rtec-guard sample);
#   - toda madrugada (02:00, Brasilia) olha os ultimos 3 dias; se menos de 8% das amostras passaram de 20%,
#     roda um teste leve de 3 h (~30% de CPU, prioridade minima: o video dos clientes passa na frente).
#
# Instalar (na maquina):  curl -fsSL .../public/proxy/guard.sh | sudo bash -s -- install
# Ver a situacao:         sudo rtec-guard status
set -euo pipefail

DIR="${RTEC_GUARD_DIR:-/var/lib/rtec-guard}"
LOG="${RTEC_GUARD_LOG:-/var/log/rtec-guard.log}"
SAMPLES="$DIR/samples.csv"   # epoch,cpu%
THRESHOLD=20                 # % de CPU que a Oracle considera "ativo"
TARGET=8                     # % minimo de amostras ativas nos ultimos 3 dias (5% e o minimo da Oracle; 8% e margem)
LOAD_HOURS=3
LOAD_PERCENT=30              # % do total da maquina durante o teste

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

cmd_sample() {
  mkdir -p "$DIR"
  read -r _ u n s i w x y z _ < /proc/stat
  local busy=$((u + n + s + x + y + z)) total=$((u + n + s + i + w + x + y + z))
  if [ -f "$DIR/last" ]; then
    read -r pb pt < "$DIR/last"
    local db=$((busy - pb)) dt=$((total - pt))
    [ "$dt" -gt 0 ] && echo "$(date +%s),$((100 * db / dt))" >> "$SAMPLES"
  fi
  echo "$busy $total" > "$DIR/last"
  # guarda so os ultimos 8 dias
  local cutoff=$(($(date +%s) - 8 * 86400))
  [ -f "$SAMPLES" ] && awk -F, -v c="$cutoff" '$1 >= c' "$SAMPLES" > "$SAMPLES.tmp" && mv "$SAMPLES.tmp" "$SAMPLES"
  return 0
}

# Imprime: total_amostras amostras_ativas percentual_ativo (ultimos 3 dias)
stats() {
  local since=$(($(date +%s) - 3 * 86400))
  [ -f "$SAMPLES" ] || { echo "0 0 0"; return; }
  awk -F, -v s="$since" -v t="$THRESHOLD" '$1 >= s { n++; if ($2 >= t) h++ } END { printf "%d %d %d\n", n, h, (n ? 100 * h / n : 0) }' "$SAMPLES"
}

cmd_nightly() {
  read -r n h pct < <(stats)
  if [ "$n" -ge 36 ] && [ "$pct" -ge "$TARGET" ]; then
    log "OK: ${pct}% das amostras ativas nos ultimos 3 dias ($h de $n). Nenhum teste necessario."
    return 0
  fi
  if [ "$n" -lt 36 ]; then
    log "Poucos dados ainda ($n amostras). Rodando teste de ${LOAD_HOURS} h por seguranca."
  else
    log "Uso baixo (${pct}% ativas, $h de $n amostras). Rodando teste de ${LOAD_HOURS} h para manter a maquina ativa."
  fi
  local cpus quota
  cpus="$(nproc)"
  quota=$((cpus * LOAD_PERCENT))
  if [ -n "${RTEC_GUARD_DRYRUN:-}" ]; then
    log "(simulacao) systemd-run CPUQuota=${quota}% RuntimeMaxSec=${LOAD_HOURS}h"
    return 0
  fi
  systemctl stop rtec-guard-load 2>/dev/null || true
  systemd-run --quiet --unit=rtec-guard-load \
    --property=CPUQuota="${quota}%" --property=Nice=19 --property=CPUSchedulingPolicy=idle \
    --property=RuntimeMaxSec="${LOAD_HOURS}h" \
    /bin/bash -c "for i in \$(seq 1 $cpus); do (while :; do :; done) & done; wait"
}

cmd_status() {
  read -r n h pct < <(stats)
  echo "Ultimos 3 dias: $n amostras, $h acima de ${THRESHOLD}% de CPU (${pct}% do tempo; meta: ${TARGET}%)."
  if systemctl is-active --quiet rtec-guard-load 2>/dev/null; then echo "Teste de atividade: RODANDO agora."; fi
  echo "Proxima verificacao: $(systemctl list-timers rtec-guard-nightly.timer --no-legend 2>/dev/null | awk '{print $1, $2, $3}')"
  echo "Ultimas decisoes:"
  tail -n 5 "$LOG" 2>/dev/null || echo "  (nenhuma ainda)"
}

cmd_install() {
  [ "$(id -u)" = 0 ] || { echo "Rode com sudo"; exit 1; }
  # Rodando via "curl | bash" nao existe arquivo local: baixa o proprio script para /usr/local/bin.
  if [ -f "$0" ] && grep -q "rtec-guard" "$0"; then
    install -m 755 "$0" /usr/local/bin/rtec-guard
  else
    curl -fsSL "${RTEC_GUARD_SRC:-https://raw.githubusercontent.com/rafanunesran/RTec/main/public/proxy/guard.sh}" -o /usr/local/bin/rtec-guard
    chmod 755 /usr/local/bin/rtec-guard
  fi
  # O servico antigo de uso constante deixa de ser necessario
  systemctl disable --now rtec-keepalive 2>/dev/null || true
  rm -f /etc/systemd/system/rtec-keepalive.service

  cat > /etc/systemd/system/rtec-guard-sample.service <<'UNIT'
[Unit]
Description=RTec: anota o uso de CPU
[Service]
Type=oneshot
ExecStart=/usr/local/bin/rtec-guard sample
UNIT
  cat > /etc/systemd/system/rtec-guard-sample.timer <<'UNIT'
[Unit]
Description=RTec: anota o uso de CPU a cada 10 minutos
[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
UNIT
  cat > /etc/systemd/system/rtec-guard-nightly.service <<'UNIT'
[Unit]
Description=RTec: verifica a atividade dos ultimos 3 dias e roda o teste se precisar
[Service]
Type=oneshot
ExecStart=/usr/local/bin/rtec-guard nightly
UNIT
  cat > /etc/systemd/system/rtec-guard-nightly.timer <<'UNIT'
[Unit]
Description=RTec: verificacao de atividade toda madrugada (02:00 de Brasilia)
[Timer]
OnCalendar=*-*-* 02:00:00 America/Sao_Paulo
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now rtec-guard-sample.timer rtec-guard-nightly.timer
  /usr/local/bin/rtec-guard sample
  echo
  echo "Vigia de atividade instalado: anota o uso a cada 10 min e, se ficar baixo, roda um teste de ${LOAD_HOURS} h de madrugada."
  echo "Ver a situacao a qualquer momento:  sudo rtec-guard status"
}

case "${1:-install}" in
  sample) cmd_sample ;;
  nightly) cmd_nightly ;;
  status) cmd_status ;;
  install) cmd_install ;;
  *) echo "Uso: rtec-guard {install|sample|nightly|status}"; exit 1 ;;
esac
