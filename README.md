# RTec IPTV Panel

Painel web para criar **logins e senhas** de clientes, cadastrar e **disponibilizar listas M3U**, e ativar dispositivos por **MAC + chave** (no modelo do Duplecast IPTV).

Frontend no stack do Lovable (Vite + React + TypeScript + Tailwind, componentes no estilo shadcn/ui), backend Node.js (Express) com banco **Firebase Firestore** e deploy na **Vercel**, tudo nos planos gratuitos.

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

## Deploy gratuito: Firebase + Vercel

### 1. Firebase (banco de dados, plano Spark gratuito)
1. Acesse https://console.firebase.google.com e crie um projeto (pode desativar o Google Analytics).
2. Menu **Build > Firestore Database > Criar banco de dados**: escolha o local **southamerica-east1 (Sao Paulo)** e o **modo de producao**.
3. Na aba **Regras** do Firestore, cole o conteudo de `firestore.rules` (bloqueia todo acesso direto; so o servidor acessa) e publique.
4. **Engrenagem > Configuracoes do projeto > Contas de servico > Gerar nova chave privada**. Baixa um arquivo `.json`: guarde com cuidado e **nunca** coloque no GitHub.

As colecoes (`admins`, `clients`, `playlists`, `devices`, `pending_devices`, `config`) sao criadas sozinhas no primeiro acesso. Nao precisa criar indices.

### 2. Vercel (site + API, plano Hobby gratuito)
1. Acesse https://vercel.com, entre com o GitHub e clique em **Add New > Project > Import** no repositorio `RTec` (branch `main`).
2. A Vercel detecta tudo pelo `vercel.json` (Vite + funcao em `api/index.js`). Nao mude os comandos.
3. Em **Environment Variables**, adicione:
   - `FIREBASE_SERVICE_ACCOUNT`: o conteudo inteiro do `.json` baixado no passo 1.4;
   - `ADMIN_PASSWORD`: a senha do seu primeiro acesso ao painel;
   - `PUBLIC_URL`: o endereco do site (ex: `https://rtec.vercel.app`). Pode adicionar depois do primeiro deploy e fazer **Redeploy**.
4. Clique em **Deploy**. O painel fica em `https://SEU-SITE/admin` e o reprodutor em `https://SEU-SITE/`.

Cada `git push` na `main` faz um novo deploy automatico.

### Limites dos planos gratuitos (importante)
- **Vercel Hobby**: uso **pessoal e nao comercial** pelos termos da Vercel; ~100 GB de trafego/mes; funcoes com no maximo 60 s. Por isso as listas novas usam reproducao **direta da fonte** (o video nao passa pela Vercel). O modo **proxy** existe por lista, mas consome a banda do plano e streams `.ts` continuos sao cortados a cada 60 s; prefira HLS (`.m3u8`).
- **Reproducao direta** exige que a fonte use `https` e libere CORS; links `http` sao bloqueados pelo navegador em sites `https`. Nesses casos use proxy (com os limites acima) ou um servidor proprio.
- **Firestore Spark**: 50 mil leituras e 20 mil gravacoes por dia, 1 GB. O servidor usa cache e grava "ultimo acesso" no maximo a cada 5 minutos para economizar. Lista **manual** colada no painel tem limite de ~900 KB (limite de documento do Firestore); listas maiores, use URL M3U.

## Rodando localmente

Requer Node.js 22.

```bash
npm install
npm run dev      # API em :3001 + frontend em http://localhost:8080
```

Sem `FIREBASE_SERVICE_ACCOUNT`, o servidor local usa um banco em memoria (os dados somem ao reiniciar). Para usar seu Firestore localmente, crie um arquivo `.env` com as variaveis de `.env.example` e rode `node --env-file=.env server/index.js`.

**Esqueceu a senha ou o `ADMIN_PASSWORD` nao funcionou?** `ADMIN_PASSWORD` so vale quando o admin e criado pela primeira vez. Para redefinir, adicione na Vercel a variavel `ADMIN_RESET_PASSWORD` com a nova senha, faca **Redeploy**, entre no painel, troque a senha em Configuracoes e apague a variavel.

Login inicial do painel: `admin` / `admin123` (ou `ADMIN_USER`/`ADMIN_PASSWORD`). **Troque a senha** em Configuracoes.

Testes: `npm test` (banco em memoria) e `npm test:firestore` (mesmos testes no emulador oficial do Firestore; precisa de Java).

Enderecos: reprodutor do cliente em `/`, painel do administrador em `/admin`.

## Editando o visual no Lovable

O frontend (`src/`) usa a mesma estrutura dos projetos Lovable. Para continuar editando o visual pelo Lovable, conecte este repositorio ao Lovable via GitHub. O backend (`server/`) precisa rodar em um servidor Node (VPS, Railway, Render etc.), pois o Lovable hospeda so o frontend.

## Estrutura

```
api/index.js     Funcao serverless da Vercel (usa o mesmo app do server/)
server/          API Express: app.js, m3u.js, epg.js, testes
server/store/    Banco: firestore.js (producao) e memory.js (testes/dev)
src/pages/       Player (cliente), Login, Painel, Clientes, Listas, Dispositivos, Configuracoes
public/          manifest.webmanifest, sw.js e icones do app instalavel
src/components/  UI (botoes, inputs, dialogos), layout e logo
```

## Aviso

Este painel apenas organiza e distribui listas que voce cadastra. Use somente conteudo que voce tem direito de distribuir.
