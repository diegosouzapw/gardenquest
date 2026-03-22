# Garden Quest

Garden Quest e um projeto web com backend em Node.js/Express e frontend estatico em HTML/CSS/JavaScript. O sistema usa Google OAuth para autenticacao, Supabase/PostgreSQL para persistencia de eventos, usuarios, perfis, chat e ranking, e uma IA opcional via OpenAI para controlar um NPC no jardim.

## Estrutura

- `backend/`: API, autenticacao, seguranca, eventos, persistencia e simulacao do jogo.
- `frontend/public/`: paginas estaticas do login, jogo e dashboard.
- `backend/game/`: motor da simulacao, regras do mundo e validacao de comandos.
- `backend/database/`: integracao PostgreSQL/Supabase e schema SQL.
- `legacy/`: artefatos antigos mantidos apenas por historico.
- `docs/security-review.md`: revisao de seguranca feita neste ciclo.

## Requisitos

- Node.js 20+
- npm 10+
- Banco PostgreSQL compativel com o schema em `backend/database/supabase-schema.sql`
- Credenciais Google OAuth
- Chave OpenAI opcional para ativar o NPC com IA

## Configuracao

1. Escolha um arquivo de ambiente:
   - `.env.local` para desenvolvimento local
   - `.env.staging` para staging
   - `.env.production` para deploy final
2. Copie a partir do exemplo correspondente:
   - `.env.local.example`
   - `.env.staging.example`
   - `.env.production.example`
3. Preencha no minimo:
   - `GOOGLE_CLIENT_ID`
   - `ADMIN_GOOGLE_EMAILS`
4. Para cada segredo abaixo, escolha um dos dois modos:
   - valor inline no `.env`
   - referencia via `*_SECRET_NAME` e `*_SECRET_VERSION`
   Segredos suportados:
   - `GOOGLE_CLIENT_SECRET`
   - `JWT_SECRET`
   - `SUPABASE_DB_URL`
   - `OPENAI_API_KEY`
5. Em staging/producao, ajuste tambem:
   - `FRONTEND_URL`
   - `GOOGLE_REDIRECT_URI`
   - `COOKIE_SECURE=true`
   - `COOKIE_DOMAIN` se houver dominio dedicado
   - `SUPABASE_DB_SSL_CA_PATH` se o ambiente exigir um arquivo CA PEM para validar o certificado do banco

### Segredos No Deploy

Para `staging` e `production`, o projeto aceita dois modos:

- Segredos inline no arquivo `.env`
- Referencias ao Google Secret Manager

Voce nao precisa usar o Google Secret Manager para o deploy funcionar. Ele e recomendado, mas opcional.

Exemplo de segredos inline:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
JWT_SECRET=your-jwt-secret
ADMIN_GOOGLE_EMAILS=admin@example.com
SUPABASE_DB_URL=postgresql://...
OPENAI_API_KEY=<your-openai-api-key>
```

Exemplo com Google Secret Manager:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleuser...
GOOGLE_CLIENT_SECRET_SECRET_NAME=gardenquest-google-client...
JWT_SECRET_SECRET_NAME=gardenquest-jwt...
JWT_SECRET_SECRET_VERSION=1
SUPABASE_DB_URL_SECRET_NAME=gardenquest-supabase-db...
SUPABASE_DB_URL_SECRET_VERSION=1
OPENAI_API_KEY_SECRET_NAME=gardenquest-openai-...
OPENAI_API_KEY_SECRET_VERSION=1
ADMIN_GOOGLE_EMAILS=admin@example.com
```

Regra pratica:

- Se usar valor inline, deixe o `*_SECRET_NAME` vazio para aquele segredo.
- Se usar Secret Manager, deixe o valor inline vazio para aquele segredo.
- `ADMIN_GOOGLE_EMAILS` nao passa por Secret Manager neste projeto; ele continua como variavel de ambiente normal.

Importante: as credenciais locais atuais devem ser rotacionadas antes de qualquer deploy. Veja `docs/security-review.md`.

### Modelo de ambiente

- `APP_ENV` define o alvo operacional: `local`, `staging` ou `production`.
- `NODE_ENV` define o modo de runtime do backend. Use `development` apenas em `APP_ENV=local`.
- O backend falha cedo se detectar combinacoes inseguras, por exemplo:
  - `APP_ENV=local` apontando para URLs remotas
  - `APP_ENV=staging` ou `production` com `COOKIE_SECURE=false`
  - `GOOGLE_REDIRECT_URI` fora de `/auth/callback`
  - `COOKIE_DOMAIN` fora do dominio do frontend
- O frontend nao e fronteira de seguranca. Autenticacao e autorizacao continuam no backend.

## Execucao local

Banco local com Docker:

```bash
docker compose -f docker-compose.local.yml up -d
```

Validar configuracao:

```bash
cd backend
npm install
npm run check:env
```

Backend:

```bash
cd backend
npm install
node server.js
```

Frontend:

- Sirva `frontend/public/` na mesma origem configurada em `FRONTEND_URL`.
- Exemplo com Python:

```bash
cd frontend/public
python -m http.server 5500
```

- Em ambiente local, o callback OAuth do Google deve apontar para `http://localhost:8080/auth/callback`.
- Crie um OAuth Client separado no Google apenas para localhost. Nao reutilize client secret nem redirect URI de producao.
- Depois de subir o backend, valide `http://localhost:8080/health`. Se aparecer `426 Upgrade Required`, outro processo esta ocupando a `8080`.
- Fora do local, a conexao com o banco valida o certificado TLS por padrao. Se o runtime nao confiar automaticamente na cadeia do provedor, preencha `SUPABASE_DB_SSL_CA_PATH` com o caminho de um arquivo PEM.

## Deploy

- `deploy.ps1`: fluxo de deploy para PowerShell/Windows.
- `deploy.sh`: fluxo de deploy para Bash/Linux/macOS.
- `backend/Dockerfile` e `frontend/Dockerfile`: imagens separadas para API e frontend.
- `docs/openai-secret-manager.md`: passo a passo para proteger `OPENAI_API_KEY` no Google Secret Manager.
- `docs/jwt-secret-manager.md`: passo a passo para proteger `JWT_SECRET` no Google Secret Manager.
- `docs/supabase-secret-manager.md`: passo a passo para proteger `SUPABASE_DB_URL` no Google Secret Manager.
- `docs/google-client-secret-manager.md`: passo a passo para proteger `GOOGLE_CLIENT_SECRET` no Google Secret Manager.
- `docs/local-development.md`: guia completo para rodar localmente com OAuth, banco e validacoes de ambiente.

Se voce nao usa Google Secret Manager, basta preencher os segredos inline no `.env.staging` ou `.env.production` e deixar os campos `*_SECRET_NAME` vazios.

Deploy com arquivo explicito:

```bash
ENV_FILE=.env.staging ./deploy.sh my-gcp-project southamerica-east1
```

```powershell
.\deploy.ps1 -ProjectId my-gcp-project -Region southamerica-east1 -EnvFile .env.production
```

Os arquivos `.dockerignore` e `.gcloudignore` foram preparados para evitar envio de segredos, caches e artefatos locais no contexto de build.

## Seguranca

- O backend usa `helmet`, `cors`, cookies `httpOnly` e rate limits por rota.
- O login Google valida um `state` de curta duracao preso ao navegador para reduzir login CSRF e troca forcada de conta.
- Os `POST` autenticados mais sensiveis validam `Origin`/`Referer` em producao para reduzir CSRF em logout, sync e comandos do jogo.
- Comandos do jogador passam por validacao e deteccao de payload suspeito.
- O dashboard administrativo usa a sessao Google e uma allowlist por email configurada em `ADMIN_GOOGLE_EMAILS`.
- Os segredos reais nao devem ficar em git nem em build contexts.
- O schema do banco ativa RLS e revoga acesso de `anon` e `authenticated` nas tabelas `event_logs`, `users`, `player_profiles`, `actor_stats` e `chat_messages`, para que esses dados nao fiquem expostos pela Data API do Supabase. O backend continua acessando por conexao direta ao Postgres.
- O chat do jogo agora e persistente em `chat_messages`, carrega as ultimas 20 mensagens ao iniciar e pode bloquear termos configurados em `PLAYER_CHAT_BLOCKED_WORDS`.

## Observacoes de manutencao

- Em banco novo, aplique `backend/database/supabase-schema.sql` antes de subir o servidor para criar `event_logs`, `users`, `player_profiles`, `actor_stats` e `chat_messages`.
- O projeto agora assume apenas o schema canonico. Se existir um banco antigo fora desse modelo, alinhe-o manualmente antes do deploy ou recrie o schema a partir de `backend/database/supabase-schema.sql`.
