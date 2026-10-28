#!/usr/bin/env bash
# Instala o servidor de video do RTec numa VPS Ubuntu (ex: Oracle Cloud "Always Free").
# Uso (no terminal da VPS):
#   curl -fsSL https://raw.githubusercontent.com/rafanunesran/RTec/main/public/proxy/install.sh | sudo bash -s -- SEU_PROXY_SECRET
# Ao final, mostra o endereco https para colocar em STREAM_PROXY_URL na Vercel.
set -euo pipefail

SECRET="${1:?Informe o PROXY_SECRET (o mesmo que vai na Vercel)}"
# De onde baixar o server.mjs (padrao: o repositorio no GitHub; pode ser o proprio site: https://SEU-SITE/proxy)
SRC="${2:-https://raw.githubusercontent.com/rafanunesran/RTec/main/public/proxy}"
SRC="${SRC%/}"
[ "$(id -u)" = 0 ] || { echo "Rode com sudo"; exit 1; }

echo "==> Descobrindo o IP publico"
IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)"
DOMAIN="${IP//./-}.sslip.io"
echo "    IP: $IP  ->  dominio: $DOMAIN"

echo "==> Instalando Node.js 22, Caddy e ffmpeg (som Dolby/AC-3 convertido para AAC)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent ffmpeg
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "==> Baixando o servidor de video"
mkdir -p /opt/rtec-proxy
curl -fsSL "$SRC/server.mjs" -o /opt/rtec-proxy/server.mjs
cat > /etc/rtec-proxy.env <<ENV
PROXY_SECRET=$SECRET
PORT=8080
ENV
chmod 600 /etc/rtec-proxy.env

cat > /etc/systemd/system/rtec-proxy.service <<'UNIT'
[Unit]
Description=RTec servidor de video
After=network-online.target

[Service]
EnvironmentFile=/etc/rtec-proxy.env
ExecStart=/usr/bin/node /opt/rtec-proxy/server.mjs
Restart=always
RestartSec=2
DynamicUser=yes
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	reverse_proxy 127.0.0.1:8080 {
		flush_interval -1
	}
}
CADDY

echo "==> Liberando as portas 80 e 443 no firewall da VPS"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true

systemctl daemon-reload
systemctl enable --now rtec-proxy
systemctl restart caddy

echo "==> Instalando o vigia de atividade (a Oracle recolhe maquinas gratis paradas)"
curl -fsSL "$SRC/guard.sh" | RTEC_GUARD_SRC="$SRC/guard.sh" bash -s -- install || echo "    (nao consegui agora; rode depois: curl -fsSL $SRC/guard.sh | sudo bash -s -- install)"

echo "==> Ligando a atualizacao automatica (o servidor se atualiza sozinho pelo GitHub)"
curl -fsSL "$SRC/autoupdate.sh" | RTEC_UPDATE_SRC="$SRC" bash -s -- install || echo "    (nao consegui agora; rode depois: curl -fsSL $SRC/autoupdate.sh | sudo bash -s -- install)"

echo "==> Testando"
sleep 5
if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then
  echo
  echo "PRONTO! Na Vercel (Settings > Environment Variables) adicione:"
  echo "  STREAM_PROXY_URL = https://$DOMAIN"
  echo "  PROXY_SECRET     = (o mesmo segredo usado aqui)"
  echo "e faca Redeploy."
else
  echo
  echo "O servidor esta rodando, mas https://$DOMAIN ainda nao respondeu."
  echo "Confira no painel da Oracle se as portas 80 e 443 estao liberadas (Security List da VCN)"
  echo "e rode de novo:  sudo systemctl restart caddy"
fi
