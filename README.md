# RTec IPTV Panel

Painel web para criar **logins e senhas** de clientes, colar a **lista M3U de cada cliente** e deixar ele assistir no **reprodutor web/app** (inspirado no Duplecast IPTV).

Frontend no stack do Lovable (Vite + React + TypeScript + Tailwind, componentes no estilo shadcn/ui), backend Node.js (Express) com banco **Firebase Firestore** e deploy na **Vercel**, tudo nos planos gratuitos.

## Funcionalidades

- **Login do administrador** (sessao em cookie httpOnly, senha com bcrypt, troca de senha).
- **Clientes**: usuario, senha (gerador automatico), validade (+1/7/30/90/365 dias), bloqueio, observacoes e a lista do cliente.
- **Cliente rapido**: cole o link `get.php?username=...&password=...` do fornecedor e o cliente e criado com o mesmo usuario, senha e validade da conta no fornecedor.
- **Formato Xtream**: links `get.php` e logins Xtream carregam pelo `player_api.php`, por categoria (TV ao vivo, filmes, series e episodios), em vez de baixar a lista M3U inteira (que em fornecedores grandes passa de 70 MB). Guia de programacao pelo `get_short_epg`.
- **Lista propria por cliente**, colada no cadastro do cliente: link M3U do fornecedor, login Xtream Codes (servidor + usuario + senha; tambem XUI.One/OneStream) ou o conteudo do arquivo `.m3u`. Botao **Testar lista** mostra quantos canais, filmes e episodios a lista tem antes de salvar. EPG (XMLTV) opcional e modo de reproducao (direto da fonte ou pelo servidor).
- **Entrega ao cliente** (para apps IPTV externos): a lista do cliente tambem sai em:
  - `GET /get.php?username=USUARIO&password=SENHA&type=m3u_plus` (formato aceito pela maioria dos apps IPTV);
  - `GET /m3u/<token>.m3u` (link curto, pode ser regenerado);
  - botao "Copiar mensagem para o cliente" com todos os dados.
- **Reprodutor do cliente** (`/`): o cliente entra com usuario e senha e ve **apenas** os canais das listas dele, separados por grupo, com busca e favoritos, e assiste direto no navegador (HLS via hls.js, MPEG-TS via mpegts.js, MP4/MKV nativo). Canais Xtream `.ts` caem automaticamente para `.m3u8` em aparelhos que nao tocam TS (iPhone).
- **Secoes TV ao vivo / Filmes / Series** (detectadas pelo padrao Xtream `/live/`, `/movie/`, `/series/` ou extensao do arquivo). Series sao agrupadas por nome com temporadas e episodios (`S01 E02`). Seletor de lista quando o cliente tem mais de uma.
- **Guia de programacao (EPG)**: "Agora / A seguir" com barra de progresso, usando o XMLTV cadastrado na lista ou o `url-tvg` do cabecalho M3U (aceita `.gz`).
- **Sincronizacao entre aparelhos**: favoritos, historico e o ponto onde o cliente parou em filmes/episodios ficam salvos na conta, nao so no aparelho. Entrando com o mesmo login em outro celular, TV ou PC, tudo aparece igual e o filme continua de onde parou. Ao abrir ou voltar para o app ele busca o que mudou nos outros aparelhos; o progresso sobe no maximo a cada 30 s para economizar gravacoes no Firestore (colecao `player_sync`).
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

As colecoes (`admins`, `clients`, `config`) sao criadas sozinhas no primeiro acesso. Nao precisa criar indices.

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
- **Modo automatico de reproducao**: links `https` tocam direto da fonte; links `http` (a maioria dos fornecedores IPTV) passam pelo servidor, porque o navegador bloqueia `http` dentro de um site `https`. Na Vercel, filmes sao entregues em pedacos de 8 MB e o ao vivo reconecta sozinho a cada ~50 s.
- **Banda**: um canal ao vivo HD consome ~3 GB por hora e um filme ~1,5 GB. Com os ~100 GB/mes do plano gratis da Vercel, isso da algo como 30 horas de TV ao vivo **somando todos os clientes**.
- **Vercel Hobby**: uso **pessoal e nao comercial** pelos termos da Vercel; ~100 GB de trafego/mes; funcoes com no maximo 60 s. Por isso as listas novas usam reproducao **direta da fonte** (o video nao passa pela Vercel). O modo **proxy** existe por lista, mas consome a banda do plano e streams `.ts` continuos sao cortados a cada 60 s; prefira HLS (`.m3u8`).
- **Reproducao direta** exige que a fonte use `https` e libere CORS; links `http` sao bloqueados pelo navegador em sites `https`. Nesses casos use proxy (com os limites acima) ou um servidor proprio.
- **Firestore Spark**: 50 mil leituras e 20 mil gravacoes por dia, 1 GB. O servidor usa cache e grava "ultimo acesso" no maximo a cada 5 minutos para economizar. Lista **manual** colada no painel tem limite de ~900 KB (limite de documento do Firestore); listas maiores, use URL M3U.

## Video sem limite

O navegador bloqueia links `http` dentro de um site `https`, entao no site o video dos fornecedores `http`
passa pelo servidor (proxy). Na Vercel gratis isso tem limite (~100 GB/mes). Ha dois caminhos sem esse limite:

### 1. App Android (Android, TV Box, Fire TV)
O app abre o mesmo site, mas o video vai **direto do fornecedor para o aparelho**, sem passar por nenhum servidor.

Gerar o APK (precisa de Java 21 e Android SDK):
```bash
export ANDROID_HOME=/caminho/android-sdk
export RTEC_KEYSTORE=/caminho/rtec-release.jks RTEC_KEYSTORE_PASSWORD='senha'
APP_URL=https://SEU-SITE.vercel.app npm run app:android
git add public/download/rtec-tv.apk && git commit -m "App Android" && git push origin main
```
Os clientes baixam em `https://SEU-SITE/download/rtec-tv.apk` (o reprodutor mostra o botao "Baixar app Android").
**Guarde o arquivo `.jks` e a senha fora do repositorio**: sem eles, uma versao nova do app nao instala por cima da antiga.

**Avisos ao instalar**: todo APK baixado fora da Play Store passa por "Permitir desta fonte" e, as vezes, pelo aviso do Play Protect
("Instalar mesmo assim"); isso nao da para remover pelo codigo. Para o cliente leigo, o botao "Baixar app Android" ja abre o passo a passo
e a pagina `https://SEU-SITE/instalar` mostra cada aviso desenhado, com o botao certo destacado (o link vai na mensagem copiada para o cliente).
O que reduz o aviso do Play Protect: assinar sempre com o mesmo `.jks`, cadastrar o app no
[Android Developer Console](https://developer.android.com/developer-verification) (verificacao de desenvolvedor, obrigatoria no Brasil
desde 30/09/2026) e pedir revisao pelo formulario de contestacao do Play Protect.

### 2. Servidor de video gratis (Oracle Cloud "Always Free", ~10 TB/mes) - navegador e iPhone
1. Crie a conta em https://www.oracle.com/cloud/free/ e uma instancia **Ubuntu** (shape Ampere A1 ou VM.Standard.E2.1.Micro).
2. Em **Networking > Virtual Cloud Network > Security List**, adicione regras de entrada TCP para as portas **80** e **443** (origem `0.0.0.0/0`).
3. Escolha um segredo (ex: gere em https://www.random.org/strings) e, no terminal da instancia, rode:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/rafanunesran/RTec/main/public/proxy/install.sh | sudo bash -s -- SEU_SEGREDO
   ```
4. O instalador mostra um endereco `https://IP.sslip.io`. Na Vercel, adicione `STREAM_PROXY_URL` (esse endereco) e `PROXY_SECRET` (o mesmo segredo) e faca **Redeploy**.

O servidor de video so aceita links assinados pelo painel, com validade de 12 h.

## App para TV Samsung (Tizen)

A pasta `tizen/` tem o app da TV Samsung (Smart TVs de 2016 em diante). Como o app Android, ele so abre o site
publicado: tela, login e catalogo sao os mesmos, e cada `git push` na `main` ja atualiza o app nas TVs.
Na TV o site liga a **navegacao pelo controle remoto**: setas mudam a selecao, OK abre, Voltar desfaz um passo
(fecha o player, a ficha, o dialogo) e sai do app no Inicio; no player, esquerda/direita voltam/avancam 10 s e
as teclas play/pause/avancar/voltar do controle funcionam. Para testar no computador, abra o site com `?tv=1`
(e `?tv=0` para desligar).

Gerar o app (precisa do [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
com a extensao **Samsung TV** e um certificado **Samsung** criado no Certificate Manager):
```bash
APP_URL=https://SEU-SITE.vercel.app TIZEN_PROFILE=meu-perfil npm run app:tizen   # gera dist-tizen/rtec-tv.wgt
```
Sem `TIZEN_PROFILE` o script so monta a pasta `dist-tizen/app` (pode ser importada no Tizen Studio).

Instalar na sua TV (modo desenvolvedor):
1. Na TV, abra **Apps**, digite `12345` no controle, ligue o **Developer mode** e coloque o IP do computador. Reinicie a TV.
2. No Tizen Studio, **Device Manager > Remote Device Manager**, adicione o IP da TV e conecte.
3. O certificado Samsung precisa incluir o **DUID** dessa TV (o Certificate Manager pega sozinho com a TV conectada).
4. `tizen install -n dist-tizen/rtec-tv.wgt -t <nome da TV em "sdb devices">`

Para os clientes instalarem pela loja da Samsung (sem modo desenvolvedor), envie o `.wgt` assinado com o
certificado de distribuicao **publico** no [Samsung Seller Office](https://seller.samsungapps.com/tv). A Samsung
revisa o app antes de publicar.

Limitacao: dentro do app o site continua em `https`, entao os canais `http` passam pelo servidor (proxy), como no
navegador. Para video direto sem limite, use o servidor de video da Oracle (acima) ou fontes `https`.

## TVs Samsung antigas (Smart Hub "Orsay", 2011 a 2014)

Navegadores antigos demais para o site (sem modulos JavaScript) vao sozinhos para a versao leve
`/tv-antiga.html` (login, ao vivo, filmes, series e reprodutor da propria TV). Para ter um icone no
Smart Hub dessas TVs:

```bash
APP_URL=https://seu-site.vercel.app npm run app:orsay
```

Copie a pasta `dist-orsay/RTecTV` para a raiz de um pendrive, ligue o pendrive na TV e desligue e
ligue a TV. O app aparece em Smart Hub > Mais apps. O pendrive precisa ficar ligado na TV.

## Ficha dos filmes e series (opcional)

A tela de cada filme/serie mostra sinopse, genero, ano, duracao, nota, direcao, elenco e trailer vindos do fornecedor.
Quando faltar algo, o painel completa pela internet: com `TMDB_API_KEY` (chave gratuita em themoviedb.org > Configuracoes > API)
usa o TMDB em portugues; sem a chave, pega a sinopse da Wikipedia.

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

O frontend (`src/`) usa a mesma estrutura dos projetos Lovable. O visual atual (tema escuro, gradiente violeta → ciano, fonte Plus Jakarta Sans) foi desenhado no Lovable e portado para cá mantendo a lógica e a API; as cores ficam como tokens HSL em `src/index.css` e `tailwind.config.js`. Para continuar editando o visual pelo Lovable, conecte este repositorio ao Lovable via GitHub. O backend (`server/`) precisa rodar em um servidor Node (VPS, Railway, Render etc.), pois o Lovable hospeda so o frontend.

## Estrutura

```
api/index.js     Funcao serverless da Vercel (usa o mesmo app do server/)
server/          API Express: app.js, m3u.js, epg.js, testes
server/store/    Banco: firestore.js (producao) e memory.js (testes/dev)
src/pages/       Player (cliente), Login, Painel, Clientes, Configuracoes
public/          manifest.webmanifest, sw.js e icones do app instalavel
tizen/           App da TV Samsung (config.xml e tela de abertura); gerado por scripts/build-tizen.sh
src/components/  UI (botoes, inputs, dialogos), layout e logo
```

## Aviso

Este painel apenas organiza e distribui listas que voce cadastra. Use somente conteudo que voce tem direito de distribuir.
