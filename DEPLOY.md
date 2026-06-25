# Publicar o site

## Opção simples: Render

1. Crie uma conta em `https://render.com`.
2. Suba este projeto para um repositorio privado no GitHub.
3. No Render, clique em **New > Web Service**.
4. Conecte o repositorio.
5. Use:

   ```text
   Runtime: Node
   Build Command: vazio
   Start Command: npm start
   ```

6. Em **Environment**, crie estas variaveis:

   ```text
   PORT=10000
   SESSION_SECRET=uma-frase-grande-e-secreta
   ADMIN_KEY=uma-chave-admin-grande
   MICROSOFT_CLIENT_ID=seu-client-id
   MICROSOFT_CLIENT_SECRET=seu-client-secret
   MICROSOFT_REDIRECT_URI=https://seu-site.onrender.com/auth/callback
   ONEDRIVE_SHARE_URL=seu-link-da-pasta
   MAX_FILE_MB=500
   CHUNK_SIZE_MB=8
   ```

7. No Azure, edite o App Registration e adicione a Redirect URI publica:

   ```text
   https://seu-site.onrender.com/auth/callback
   ```

8. Depois que o site estiver publicado, ative o OneDrive uma vez acessando:

   ```text
   https://seu-site.onrender.com/auth/login?key=SUA_ADMIN_KEY
   ```

9. Compartilhe com os convidados somente:

   ```text
   https://seu-site.onrender.com
   ```

## Cuidado importante

O arquivo `.token-cache.json` guarda a autorizacao do OneDrive. Em hospedagens sem disco persistente, esse arquivo pode sumir quando o servidor reiniciar ou for publicado novamente. Se isso acontecer, basta abrir de novo:

```text
https://seu-site/auth/login?key=SUA_ADMIN_KEY
```

Para evitar reativacoes, use uma hospedagem com disco persistente ou uma VPS.
