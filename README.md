# RTec IPTV Panel

Painel web para criar **logins e senhas** de clientes, cadastrar e **disponibilizar listas M3U**, e ativar dispositivos por **MAC + chave** (no modelo do Duplecast IPTV).

Frontend no stack do Lovable (Vite + React + TypeScript + Tailwind, componentes no estilo shadcn/ui), backend Node.js (Express + SQLite nativo do Node).

## Funcionalidades

- **Login do administrador** (sessao em cookie httpOnly, senha com bcrypt, troca de senha).
- **Clientes**: usuario, senha (gerador automatico), validade (+1/7/30/90/365 dias), limite de dispositivos, bloqueio, observacoes e quais listas cada um recebe.
- **Listas M3U** de tres tipos:
  - URL M3U existente;
  - servidor Xtream Codes (servidor + usuario + senha);
  - conteudo manual (colar texto ou enviar arquivo `.m3u`).
  - Botao **Testar**: carrega a lista e mostra canais, grupos e logos. EPG (XMLTV) opcional.
- **Entrega ao cliente**: todas as listas liberadas sao mescladas em um unico M3U:
  - `GET /get.php?username=USUARIO&password=SENHA&type=m3u_plus` (formato aceito pela maioria dos apps IPTV);
  - `GET /m3u/<token>.m3u` (link curto, pode ser regenerado);
  - botao "Copiar mensagem para o cliente" com todos os dados.
- **Ativacao por aparelho (modelo Duplecast)**: no reprodutor o cliente escolhe "Codigo do aparelho" e ve um **Device ID**, uma **Device Key** e um **QR code**. O revendedor escaneia o QR (abre o painel ja preenchido) ou digita os dados em Dispositivos; o aparelho entra sozinho assim que e vinculado. Aparelhos aguardando aparecem em "Aguardando ativacao". Apps externos podem consultar `GET /api/device/playlists?mac=ID&key=CHAVE`.
- **Reprodutor do cliente** (`/`): o cliente entra com usuario e senha e ve **apenas** os canais das listas dele, separados por grupo, com busca e favoritos, e assiste direto no navegador (HLS via hls.js, MPEG-TS via mpegts.js, MP4/MKV nativo). Canais Xtream `.ts` caem automaticamente para `.m3u8` em aparelhos que nao tocam TS (iPhone).
- **Secoes TV ao vivo / Filmes / Series** (detectadas pelo padrao Xtream `/live/`, `/movie/`, `/series/` ou extensao do arquivo). Series sao agrupadas por nome com temporadas e episodios (`S01 E02`). Seletor de lista quando o cliente tem mais de uma.
- **Guia de programacao (EPG)**: "Agora / A seguir" com barra de progresso, usando o XMLTV cadastrado na lista ou o `url-tvg` do cabecalho M3U (aceita `.gz`).
- **Controle parental**: grupos adultos sao bloqueados automaticamente e o cliente pode bloquear outros grupos. PIN padrao `0000`, trocavel no reprodutor; o revendedor pode resetar o PIN no cadastro do cliente.
- **Proxy de streams**: os videos e logos passam pelo servidor, evitando bloqueio de CORS e de conteudo `http` em site `https`. So URLs assinadas para o cliente logado sao aceitas (nao e um proxy aberto). Atencao: o trafego de video passa pela banda do seu servidor.
- **App instalavel (PWA)**: no Android/Chrome aparece o botao "Instalar app"; no iPhone, o botao mostra o passo a passo (Safari → Compartilhar → Adicionar a Tela de Inicio). Exige HTTPS em producao.
- Clientes expirados ou bloqueados recebem `401/403` automaticamente.

## Rodando

Requer Node.js 22.13+.

```bash
npm install
npm run dev      # API em :3001 + frontend em http://localhost:8080
```

Producao:

```bash
npm run build
ADMIN_PASSWORD=sua-senha PUBLIC_URL=https://iptv.seudominio.com npm start   # serve tudo em :3001
```

Enderecos: reprodutor do cliente em `/`, painel do administrador em `/admin`.

Login inicial do admin: `admin` / `admin123` (ou o definido em `ADMIN_USER`/`ADMIN_PASSWORD`). **Troque a senha** em Configuracoes. Veja `.env.example` para todas as variaveis.

Testes da API: `npm test`.

## Editando o visual no Lovable

O frontend (`src/`) usa a mesma estrutura dos projetos Lovable. Para continuar editando o visual pelo Lovable, conecte este repositorio ao Lovable via GitHub. O backend (`server/`) precisa rodar em um servidor Node (VPS, Railway, Render etc.), pois o Lovable hospeda so o frontend.

## Estrutura

```
server/          API Express + SQLite (app.js, db.js, m3u.js, testes)
src/pages/       Player (cliente), Login, Painel, Clientes, Listas, Dispositivos, Configuracoes
public/          manifest.webmanifest, sw.js e icones do app instalavel
src/components/  UI (botoes, inputs, dialogos), layout e logo
```

## Aviso

Este painel apenas organiza e distribui listas que voce cadastra. Use somente conteudo que voce tem direito de distribuir.
