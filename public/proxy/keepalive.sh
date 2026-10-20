#!/usr/bin/env bash
# Substituido pelo vigia de atividade (guard.sh), que so roda o teste de madrugada quando o uso fica baixo.
set -euo pipefail
curl -fsSL https://raw.githubusercontent.com/rafanunesran/RTec/main/public/proxy/guard.sh | bash -s -- install
