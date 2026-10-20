# RTec IPTV Panel

## Regras do repositorio
- **Sempre commitar e fazer push direto na branch `main`** (`git push origin main`). Nao usar branches de trabalho nem abrir pull requests, a menos que o dono peca. A Vercel publica a `main` automaticamente.
- Antes de commitar: `npx tsc -p .`, `npm run build` e `npm test` precisam passar.

## Stack
- Frontend: Vite + React + TypeScript + Tailwind (`src/`). Reprodutor do cliente em `/`, painel admin em `/admin`. PWA (`public/manifest.webmanifest`, `public/sw.js`).
- Backend: Express (`server/app.js`), servido na Vercel por `api/index.js` (rotas em `vercel.json`).
- Banco: Firebase Firestore (`server/store/firestore.js`); `server/store/memory.js` para testes e dev sem credenciais.
- Tudo nos planos gratuitos (Vercel Hobby + Firebase Spark): evitar trafego de video pelo servidor e economizar leituras/gravacoes no Firestore.
- Textos da interface em portugues.
