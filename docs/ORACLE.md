# Servidor de video gratis na Oracle Cloud (passo a passo)

Serve para o video tocar no navegador (inclusive iPhone) sem o limite da Vercel.
Plano **Always Free** da Oracle: ~10 TB de trafego por mes, sem custo.

## 1. Criar a maquina Ubuntu
1. Entre em https://cloud.oracle.com
2. Menu **☰** (canto superior esquerdo) → **Compute** → **Instances** → botao **Create instance**.
3. **Name**: `rtec-video`
4. Secao **Image and shape** → **Edit**:
   - **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04** → **Select image**
   - **Change shape** → **Ampere** → **VM.Standard.A1.Flex** (1 OCPU, 6 GB) → **Select shape**
     (se aparecer *Out of capacity*: **AMD** → **VM.Standard.E2.1.Micro**)
5. Secao **Networking**: deixe o padrao e confirme **Automatically assign public IPv4 address** ligado.
6. Secao **Add SSH keys**: **Generate a key pair for me** → **Save private key** (guarde o arquivo `.key`).
7. **Create**. Espere ficar verde (**RUNNING**) e anote o **Public IP address**.

## 2. Liberar as portas 80 e 443
1. Na pagina da maquina, em **Primary VNIC**, clique no link da **Subnet**.
2. Aba **Security** (ou **Security Lists**) → **Default Security List for ...**
3. **Add Ingress Rules**:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: `TCP`
   - Destination Port Range: `80,443`
4. **Add Ingress Rules** para salvar.

## 3. Entrar na maquina
Windows (PowerShell), trocando o arquivo e o IP:
```powershell
ssh -i "$HOME\Downloads\ssh-key-AAAA-MM-DD.key" ubuntu@SEU_IP
```
Se reclamar de permissao do arquivo:
```powershell
icacls "$HOME\Downloads\ssh-key-AAAA-MM-DD.key" /inheritance:r /grant:r "$($env:USERNAME):R"
```
Mac/Linux: `chmod 600 arquivo.key` e o mesmo `ssh -i arquivo.key ubuntu@SEU_IP`.
Celular: app **Termius** (importe o arquivo `.key`, usuario `ubuntu`).

## 4. Instalar (um comando)
Dentro da maquina (`ubuntu@rtec-video:~$`):
```bash
curl -fsSL https://raw.githubusercontent.com/rafanunesran/RTec/main/public/proxy/install.sh | sudo bash -s -- SEU_PROXY_SECRET
```
Ao final aparece **PRONTO!** e um endereco `https://IP-COM-TRACOS.sslip.io`.

## 5. Ligar na Vercel
Projeto → **Settings** → **Environment Variables**:
- `STREAM_PROXY_URL` = endereco mostrado pelo instalador
- `PROXY_SECRET` = o mesmo segredo usado no comando
Depois **Deployments** → **⋯** → **Redeploy**.

## Manter a maquina ativa
O instalador ja liga um servico leve (~25% de CPU, prioridade minima) para a Oracle nao recolher a maquina por inatividade.
Em maquinas instaladas antes, rode uma vez dentro da maquina:
```bash
curl -fsSL https://raw.githubusercontent.com/rafanunesran/RTec/main/public/proxy/keepalive.sh | sudo bash
```

## Problemas
- Sem "PRONTO!": confira o passo 2 e rode `sudo systemctl restart caddy`.
- Ver se esta rodando: `sudo systemctl status rtec-proxy` (deve mostrar *active (running)*).
- Logs do servidor de video: `sudo journalctl -u rtec-proxy -f`
