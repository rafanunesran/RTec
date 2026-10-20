#!/usr/bin/env bash
# Cria a maquina gratis do RTec na Oracle Cloud, tentando de novo ate haver vaga.
# Rode no Cloud Shell da Oracle (icone >_ no topo do painel):
#   curl -fsSL https://raw.githubusercontent.com/rafanunesran/RTec/main/docs/oracle-criar-vm.sh | bash
# Usa a rede "rtec-rede" (criada pelo VCN Wizard) e tenta, a cada minuto, os dois modelos Always Free:
# VM.Standard.A1.Flex (Ampere, 1 OCPU/6 GB) e VM.Standard.E2.1.Micro (AMD).
set -uo pipefail

C="${OCI_TENANCY:?Rode este script no Cloud Shell da Oracle}"
NAME="rtec-video"
KEY="$HOME/.ssh/rtec"

echo "==> Preparando"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -f "$KEY" -C rtec >/dev/null
AD="$(oci iam availability-domain list --compartment-id "$C" --query 'data[0].name' --raw-output)"
SUBNET="$(oci network subnet list --compartment-id "$C" --all --query "data[?contains(\"display-name\", 'public')].id | [0]" --raw-output)"
if [ -z "$SUBNET" ] || [ "$SUBNET" = "null" ]; then
  echo "Nao achei a sub-rede publica. Crie a rede pelo 'Start VCN Wizard' (Create VCN with Internet Connectivity) e rode de novo."
  exit 1
fi
image_for() {
  oci compute image list --compartment-id "$C" --operating-system "Canonical Ubuntu" --operating-system-version "22.04" \
    --shape "$1" --sort-by TIMECREATED --sort-order DESC --query "data[?!contains(\"display-name\", 'Minimal')].id | [0]" --raw-output
}
IMG_A1="$(image_for VM.Standard.A1.Flex)"
IMG_E2="$(image_for VM.Standard.E2.1.Micro)"
echo "    Area: $AD"

launch() { # $1 shape  $2 image  [$3 shape-config]
  local extra=()
  [ -n "${3:-}" ] && extra=(--shape-config "$3")
  oci compute instance launch --compartment-id "$C" --availability-domain "$AD" --display-name "$NAME" \
    --shape "$1" "${extra[@]}" --image-id "$2" --subnet-id "$SUBNET" --assign-public-ip true \
    --ssh-authorized-keys-file "$KEY.pub" --wait-for-state RUNNING --query 'data.id' --raw-output 2>/tmp/rtec-err.txt
}

try=0
while true; do
  try=$((try + 1))
  for shape in A1 E2; do
    if [ "$shape" = A1 ]; then
      ID="$(launch VM.Standard.A1.Flex "$IMG_A1" '{"ocpus":1,"memoryInGBs":6}')"
    else
      ID="$(launch VM.Standard.E2.1.Micro "$IMG_E2")"
    fi
    if [ -n "$ID" ] && [ "$ID" != "null" ]; then
      IP="$(oci compute instance list-vnics --instance-id "$ID" --query 'data[0]."public-ip"' --raw-output)"
      echo
      echo "MAQUINA CRIADA! ($shape)  IP publico: $IP"
      echo "Para entrar nela, rode aqui mesmo no Cloud Shell:"
      echo "  ssh -i ~/.ssh/rtec -o StrictHostKeyChecking=accept-new ubuntu@$IP"
      exit 0
    fi
    if ! grep -qi "capacity" /tmp/rtec-err.txt; then
      echo "Erro diferente de falta de vaga:"; cat /tmp/rtec-err.txt; exit 1
    fi
  done
  echo "Tentativa $try: sem vaga em $(date +%H:%M). Tentando de novo em 60 s (deixe esta aba aberta)..."
  sleep 60
done
