# Revisao de Seguranca

Data: 2026-03-21

## Escopo

- Segredos e credenciais no workspace
- CORS, cookies e rate limiting
- Scripts de deploy
- Build contexts de git/docker/gcloud
- Arquivos auxiliares sem uso no fluxo principal

## Achados

### Critico

1. O arquivo `.env` local contem credenciais reais de Google OAuth, Supabase, OpenAI, senha administrativa e segredo JWT.
   - Impacto: qualquer exposicao desse arquivo compromete autenticacao, banco, dashboard e consumo da API OpenAI.
   - Acao obrigatoria: rotacionar `GOOGLE_CLIENT_SECRET`, `SUPABASE_DB_URL`/senha do banco, `OPENAI_API_KEY` e `JWT_SECRET`.

### Alto

2. O CORS de producao aceitava `origin.startsWith(candidate)`, o que permitia bypass por dominios maliciosos com prefixo parecido.
   - Correcao aplicada: comparacao por `origin` normalizado, correspondencia exata e allowlist de producao restrita a origem configurada do frontend.

3. O `deploy.sh` fazia `source .env`, o que era inseguro para valores com caracteres especiais como `$`, `&` e `*`.
   - Correcao aplicada: parsing literal de `KEY=VALUE` sem executar o arquivo.

### Medio

4. O login Google aceitava `state` sem amarrar o callback ao navegador que iniciou o fluxo.
   - Correcao aplicada: o backend agora emite um nonce em cookie `httpOnly` de curta duracao e valida o `state` no callback OAuth.

5. Os `POST` autenticados dependiam apenas do cookie de sessao e do `SameSite`.
   - Correcao aplicada: logout, sync e comandos do jogo agora validam `Origin`/`Referer` contra a origem do frontend em producao.

6. O dashboard administrativo agora depende da sessao Google e de uma allowlist por email.
   - Correcao aplicada: o acesso por senha compartilhada foi removido e o painel usa autenticacao Google com allowlist.
   - Risco residual: a allowlist precisa ser mantida corretamente em `ADMIN_GOOGLE_EMAILS`.

7. Faltavam arquivos de ignore padronizados para alguns contextos de build.
   - Correcao aplicada: criados `.dockerignore` e `.gcloudignore` na raiz e no `frontend/`.

8. O `connect-src` do CSP incluia `localhost` mesmo fora de ambiente local.
   - Correcao aplicada: `localhost` passou a ser adicionado ao `connectSrc` apenas quando `APP_ENV=local` (controlado por `CSP_ALLOW_LOCAL_CONNECT_SRC`).

## Itens revisados sem vazamento no codigo versionavel

- Nao encontrei chaves reais embutidas no frontend estatico.
- Nao encontrei leitura de paths controlados por usuario no backend.
- Os comandos do jogo possuem validacao contra payload suspeito e padroes de injecao.

## Acoes recomendadas

1. Rotacionar imediatamente todas as credenciais do `.env`.
2. Mover segredos de deploy para um cofre, como Google Secret Manager.
3. Revisar periodicamente a allowlist administrativa em `ADMIN_GOOGLE_EMAILS`.
4. Manter `.env` somente local e nunca reutilizar credenciais que ja ficaram expostas.
