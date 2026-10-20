#!/usr/bin/env bash
# Mantem a maquina gratis da Oracle "ativa" para ela nao ser recolhida por inatividade.
# A Oracle recolhe instancias Always Free quando, em 7 dias, o uso (95o percentil) de CPU fica abaixo de 20%.
# Este servico usa ~25% da CPU o tempo todo, com prioridade minima: o video dos clientes sempre passa na frente.
# Uso (na maquina):  curl -fsSL https://raw.githubusercontent.com/rafanunesran/RTec/main/public/proxy/keepalive.sh | sudo bash
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo"; exit 1; }

CPUS="$(nproc)"
QUOTA=$((CPUS * 27))   # ~27% do total da maquina (CPUQuota conta 100% por nucleo)

cat > /etc/systemd/system/rtec-keepalive.service <<UNIT
[Unit]
Description=RTec: mantem a VM ativa (evita recolhimento por inatividade da Oracle)
After=network-online.target

[Service]
# Laco ocupado limitado pelo systemd a ~27% da maquina, com a menor prioridade possivel.
ExecStart=/bin/bash -c 'for i in \$\$(seq 1 $CPUS); do (while :; do :; done) & done; wait'
CPUQuota=${QUOTA}%
Nice=19
CPUSchedulingPolicy=idle
Restart=always
DynamicUser=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now rtec-keepalive
sleep 3
echo
echo "Servico de atividade ligado (${CPUS} nucleo(s), limite ${QUOTA}% de CPU, prioridade minima)."
echo "Conferir:  systemctl status rtec-keepalive   |   uso:  top  (processo bash ~25%)"
