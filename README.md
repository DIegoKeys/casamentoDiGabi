# Upload para OneDrive pessoal

Site em Node.js para receber imagens e videos pelo navegador e enviar para pastas do seu OneDrive pessoal. O visitante escolhe entre fotos do casamento e fotos de Quest, sem precisar ter conta Microsoft: a conta do OneDrive e conectada uma unica vez no servidor.

## Como configurar

1. Copie `.env.example` para `.env` e preencha os campos.

2. Crie um aplicativo no Microsoft Azure:

   - Acesse `https://portal.azure.com`
   - Crie um **App registration**
   - Em **Supported account types**, escolha contas pessoais Microsoft
   - Em **Redirect URI**, use `Web` com `http://localhost:3000/auth/callback`
   - Em **Certificates & secrets**, crie um client secret
   - Copie o **Application (client) ID** e o secret para o `.env`

3. Rode o servidor:

   ```bash
   npm start
   ```

4. Abra `http://localhost:3000`, clique em **Ativar** e entre com a conta Microsoft dona do OneDrive.

Depois disso, os arquivos enviados pelo site vao para a pasta configurada em `ONEDRIVE_SHARE_URL`/`ONEDRIVE_FOLDER` ou `ONEDRIVE_QUEST_SHARE_URL`/`ONEDRIVE_QUEST_FOLDER`.

## Observacoes

- O app aceita apenas arquivos com tipo `image/*` ou `video/*`.
- Arquivos grandes sao enviados em partes pequenas do navegador para o servidor e do servidor para o OneDrive.
- O token fica salvo localmente em `.token-cache.json`, que ja esta no `.gitignore`.
- O servidor usa apenas recursos nativos do Node.js, sem dependencias externas.
- Os convidados nao fazem login. Somente o responsavel clica em `/auth/login` uma vez para autorizar o servidor.
- Em producao, use `ADMIN_KEY` e ative com `/auth/login?key=SUA_ADMIN_KEY`.
- Para publicar na internet, troque `MICROSOFT_REDIRECT_URI` para a URL publica do site e configure a mesma URL no Azure.

Veja tambem: `DEPLOY.md`.
