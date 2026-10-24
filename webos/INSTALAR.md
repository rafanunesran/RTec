# RTec TV na LG (webOS)

O app é só um "atalho" que abre o site do RTec em tela cheia, como o app Android e o app Samsung.
Tela, login e controle remoto vêm do próprio site, então atualizações no site chegam na TV sem reinstalar.

Arquivo do app: `rtec-tv-lg.ipk` (baixe em https://r-tec-pink.vercel.app/download/rtec-tv-lg.ipk).
Para gerar de novo: `APP_URL=https://r-tec-pink.vercel.app npm run app:webos` (sai em `dist-webos/`).

## Dá para instalar com o arquivo, como no Android?

Não do mesmo jeito. A LG não deixa instalar um `.ipk` pelo pendrive ou pelo navegador da TV.
Os caminhos são:

1. **Modo desenvolvedor (recomendado para teste)**: grátis, oficial, precisa de um PC na mesma rede uma vez.
2. **Homebrew Channel (root)**: só funciona em algumas versões de firmware que têm falha conhecida,
   a LG corrige nas atualizações, e pode dar problema na garantia. Não recomendado para clientes.
3. **Loja da LG (LG Content Store)**: o cliente instala direto da loja, mas a publicação passa por
   análise da LG (semanas a meses) e exige conta de vendedor.
4. **Sem instalar nada**: abrir https://r-tec-pink.vercel.app no navegador da TV LG. O site já entra
   sozinho na versão TV (controle remoto, tela grande).

## Modo desenvolvedor, passo a passo

### 1. Conta de desenvolvedor LG (no PC ou celular)

Crie uma conta grátis em https://webostv.developer.lge.com (botão "Sign in" > "Create account").

### 2. Ligar o modo desenvolvedor na TV

1. Na TV, abra a **LG Content Store** (ou "Apps") e procure **Developer Mode**. Instale e abra.
2. Entre com a conta criada no passo 1.
3. Ligue **Dev Mode Status**. A TV reinicia.
4. Abra o Developer Mode de novo e ligue **Key Server**.
5. Anote o **IP** e a **Passphrase** que aparecem na tela.

O modo desenvolvedor tem prazo (o app mostra o tempo restante). Antes de acabar, abra o Developer Mode e
aperte **Extend**. Se o prazo acabar, os apps instalados por ele somem e é preciso instalar de novo.

### 3a. Instalar pelo webOS Dev Manager (mais fácil no Windows)

1. Baixe o instalador `.exe` mais novo em https://github.com/webosbrew/dev-manager-desktop/releases
2. Abra o programa e clique em **Add device**: escolha "Developer Mode", digite o IP e a Passphrase da TV.
3. Vá em **Apps** > **Install** e escolha o arquivo `rtec-tv-lg.ipk`.
4. O app "RTec TV" aparece na lista de apps da TV.

### 3b. Instalar pela linha de comando (alternativa)

Precisa do Node.js (https://nodejs.org). No Prompt de Comando, um comando de cada vez:

```
npm install -g @webos-tools/cli
```

```
ares-setup-device
```

Escolha "add", nome `lgtv`, IP da TV, porta `9922`, usuário `prisoner`, e confirme o resto com Enter.

```
ares-novacom --device lgtv --getkey
```

Digite a Passphrase que aparece na TV.

```
ares-install --device lgtv rtec-tv-lg.ipk
```

```
ares-launch --device lgtv app.rtec.tv
```

## Controle remoto

- Setas e OK navegam; **Voltar** volta dentro do site (na tela inicial vai para a escolha de perfil).
- **CH+ / CH-** troca de canal ou episódio no player.
- **Botão vermelho** recarrega o site (pega a versão nova).
- Para sair do app, use o botão **Home**.

TVs LG antigas (webOS 1 a 3) que não rodam o site novo são levadas sozinhas para a versão leve (`/tv-antiga.html`).
