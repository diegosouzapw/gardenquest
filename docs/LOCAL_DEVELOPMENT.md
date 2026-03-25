# Desenvolvimento Local

Este documento descreve como subir o projeto localmente sem enfraquecer o modelo de seguranca do deploy.

## Resumo em 5 minutos

Para um setup rapido de desenvolvimento:

1. `cp .env.local.example .env.local`
2. ajustar `SUPABASE_DB_URL` e `JWT_SECRET` (Google OAuth **nao e necessario** localmente)
3. `docker compose -f docker-compose.local.yml up -d`
4. `npm --prefix backend install`
5. `npm --prefix backend run start:api` e `npm --prefix backend run start:worker`
6. `cd frontend/public && python3 -m http.server 5500`
7. abrir `http://localhost:5500` e usar o login dev

> **Nota:** Google OAuth so e obrigatorio em producao. Localmente, o sistema oferece um login dev automatico.

Se quiser detalhes de cada etapa e de seguranca, continue nas secoes abaixo.

## Objetivo

O projeto foi estruturado para manter a seguranca no backend, mesmo com o codigo do frontend publico. Isso significa:

- o frontend nao decide autenticacao nem autorizacao
- o Google OAuth termina no backend
- cookies, allowlist administrativa e validacoes de origem ficam no backend
- segredos de desenvolvimento, staging e producao devem ser separados

## Modelo de ambiente

O backend agora usa duas variaveis diferentes:

- `APP_ENV`: define o alvo operacional do projeto
  - `local`
  - `staging`
  - `production`
- `NODE_ENV`: define o modo de runtime do Node
  - use `development` apenas com `APP_ENV=local`
  - use `production` com `APP_ENV=staging` ou `APP_ENV=production`

### Regras validadas na inicializacao

O backend falha cedo se encontrar configuracoes inseguras, por exemplo:

- `APP_ENV=local` apontando para `FRONTEND_URL` remoto
- `APP_ENV=staging` ou `production` com `COOKIE_SECURE=false`
- `GOOGLE_REDIRECT_URI` sem o path `/auth/callback`
- `COOKIE_DOMAIN` fora do dominio do frontend
- `APP_ENV=local` com `NODE_ENV=production`

## Arquivos de ambiente

Arquivos disponiveis:

- `.env.local.example`
- `.env.staging.example`
- `.env.production.example`
- `.env.example`

Recomendacao:

1. Copie `.env.local.example` para `.env.local`
2. Ajuste apenas os valores locais
3. Nao reutilize credenciais de producao

### Ordem de carregamento

O backend carrega arquivos nesta ordem:

1. `.env`
2. `.env.local`, `.env.staging` ou `.env.production`, conforme `APP_ENV`
3. arquivo explicitamente indicado por `ENV_FILE`

Na pratica:

- para desenvolvimento, prefira `.env.local`
- evite manter segredos reais em `.env`
- se o seu `.env` antigo ja recebeu credenciais reais, rotacione essas credenciais

## Requisitos

- Node.js 20+
- npm 10+
- Docker + Docker Compose
- um banco PostgreSQL compativel
- (para producao) um cliente OAuth Web do Google

## Fluxo recomendado para rodar localmente

### 1. Configurar o arquivo de ambiente

Comece a partir de `.env.local.example`.

Campos importantes no local:

```env
APP_ENV=local
NODE_ENV=development
PORT=8080
FRONTEND_URL=http://localhost:5500
GOOGLE_REDIRECT_URI=http://localhost:8080/auth/callback
COOKIE_SECURE=false
COOKIE_SAME_SITE=Lax
SUPABASE_DB_SSL=false
SUPABASE_DB_SSL_CA_PATH=
```

Tambem preencha:

- `JWT_SECRET`
- `ADMIN_GOOGLE_EMAILS`
- `SUPABASE_DB_URL`

Google OAuth **nao e necessario** para desenvolvimento local. O sistema oferece um login dev automatico quando `APP_ENV=local`.

Se quiser usar Google OAuth localmente, preencha tambem:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## Banco de dados local

### Opcao A: PostgreSQL local com Docker

O repositorio inclui um arquivo pronto:

```bash
docker compose -f docker-compose.local.yml up -d
```

Esse container sobe um Postgres local na porta configurada no `docker-compose.local.yml` (padrao `5432`).

> **Conflito de porta:** Se a porta `5432` ja estiver ocupada por outro PostgreSQL,
> altere o mapeamento de porta em `docker-compose.local.yml` (ex: `5434:5432`)
> e ajuste `SUPABASE_DB_URL` para usar a nova porta.

Connection string esperada no `.env.local`:

```env
SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:5432/gardenquest_dev
SUPABASE_DB_SSL=false
SUPABASE_DB_SSL_CA_PATH=
```

### Opcao B: usar um projeto Supabase

Voce tambem pode usar um banco hospedado no Supabase, desde que a connection string seja colocada em `SUPABASE_DB_URL`.

Importante:

- so configurar o `SUPABASE_DB_URL` nao basta
- o schema inicial precisa ser aplicado manualmente
- se o banco remoto exigir CA PEM explicita para validar TLS, configure `SUPABASE_DB_SSL_CA_PATH`

## Tabelas e schema

O projeto depende do SQL em `backend/database/supabase-schema.sql`.

O que precisa acontecer:

1. aplique `backend/database/supabase-schema.sql` no banco
2. depois suba o backend

Esse schema tambem:

- cria `event_logs`, `users`, `player_profiles`, `actor_stats` e `chat_messages`
- ativa RLS nessas tabelas
- revoga acesso dos papeis `anon` e `authenticated`
- protege essas tabelas contra exposicao acidental pela Data API do Supabase
- deixa o chat persistente, carregando as ultimas 20 mensagens visiveis
- em Postgres puro sem os papeis do Supabase, o SQL ignora apenas essas politicas especificas e segue criando as tabelas

### O que o backend cria automaticamente

Ao iniciar, o backend faz alguns ajustes incrementais:

- valida a conexao
- cria `public.event_logs`, `public.users`, `public.player_profiles`, `public.actor_stats` e `public.chat_messages` se faltarem
- cria alguns indices e politicas de seguranca se faltarem
- sincroniza apelido/cor do jogador em `public.player_profiles`
- usa `PLAYER_CHAT_BLOCKED_WORDS` para a moderacao simples do chat

### O que ele nao faz sozinho

Se o banco estiver fora do schema canonico atual, o backend nao reorganiza historico legado sozinho.

Entao o correto e:

- alinhar ou recriar o banco para o schema de `backend/database/supabase-schema.sql`
- depois subir o backend

## Autenticacao local (Dev Login)

Quando `APP_ENV=local`, o sistema habilita automaticamente um **login de desenvolvimento** que nao depende do Google OAuth.

Na tela de login (`index.html`), alem do botao Google, aparece um formulario "Dev Mode" com campos de nome e email pre-preenchidos. Basta clicar "Entrar como Dev" para criar uma sessao JWT local.

O login dev:

- gera um user ID deterministico baseado no email
- cria uma sessao no banco identica ao fluxo Google
- define o cookie `auth_token` normalmente
- so funciona em `APP_ENV=local` — em producao os endpoints retornam `404`

### Endpoints do login dev

- `GET /auth/dev-mode` — retorna se o dev login esta ativo e o email default
- `POST /auth/dev-login` — recebe `{ name, email }` e cria a sessao

## Google OAuth (obrigatorio somente em producao)

Para desenvolvimento local, **Google OAuth e opcional**. Se quiser usar, crie um cliente OAuth do tipo `Web application` separado do cliente de producao.

### Valores que devem entrar no Google Cloud

Para desenvolvimento local, o valor importante no seu fluxo atual e o callback do backend.

`Authorized redirect URIs`:

```text
http://localhost:8080/auth/callback
```

`Authorized JavaScript origins`:

- nao e obrigatorio para o fluxo atual, porque o login principal nao acontece direto no frontend com a SDK do Google
- se voce quiser deixar preparado para login direto no browser no futuro, pode adicionar:

```text
http://localhost:5500
http://localhost
```

### Separacao entre ambientes

Use clientes OAuth separados:

- um cliente para `local`
- um cliente para `staging`
- um cliente para `production`

Nao misture localhost no cliente de producao.

### Se a API local usar outra porta

Se `8080` estiver ocupada, voce pode subir o backend em outra porta, por exemplo `8081`.

Nesse caso, ajuste:

```env
PORT=8081
GOOGLE_REDIRECT_URI=http://localhost:8081/auth/callback
```

Tambem atualize o cliente OAuth no Google Cloud:

```text
http://localhost:8081/auth/callback
```

E abra o frontend uma vez com override de API:

```text
http://localhost:5500/?api=http://localhost:8081
```

O frontend salva esse valor no navegador e passa a usar `8081` nas proximas cargas.

Para limpar esse override depois, rode no console do navegador:

```js
localStorage.removeItem('img_platform_api_url');
localStorage.removeItem('gardenquest.localApiUrl');
```

## Validar a configuracao antes de subir

Existe um comando para verificar a configuracao carregada:

```bash
cd backend
npm install
npm run check:env
```

Esse comando mostra:

- `APP_ENV`
- `NODE_ENV`
- arquivos de ambiente carregados
- `FRONTEND_URL`
- `GOOGLE_REDIRECT_URI`
- flags de cookie/SSL
- presenca ou ausencia dos segredos esperados

## Subindo o backend

Modo recomendado (API + Worker):

```bash
cd backend
npm install
npm run start:api
```

Em outro terminal:

```bash
cd backend
npm run start:worker
```

Modo legado (monolito):

```bash
cd backend
npm install
npm run start:legacy
```

Se o banco estiver correto, o backend deve subir em:

```text
http://localhost:8080
```

## Subindo o frontend

Sirva `frontend/public` com qualquer servidor estatico, desde que a origem bata com `FRONTEND_URL`.

Exemplo com Python:

```bash
cd frontend/public
python -m http.server 5500
```

Exemplo com Live Server:

- configure o Live Server para usar a porta `5500`
- confirme que o frontend esta abrindo em `http://localhost:5500`

## Fluxo final de teste local

1. criar `.env.local` a partir de `.env.local.example`
2. preencher `SUPABASE_DB_URL`, `JWT_SECRET` e `ADMIN_GOOGLE_EMAILS`
3. subir o Postgres com `docker compose -f docker-compose.local.yml up -d`
4. aplicar `backend/database/supabase-schema.sql` se o banco ainda estiver vazio
5. rodar `cd backend && npm install && npm run check:env`
6. rodar `cd backend && npm run start:api`
7. em outro terminal, rodar `cd backend && npm run start:worker`
8. rodar `cd frontend/public && python3 -m http.server 5500`
9. abrir `http://localhost:5500`
10. clicar "Entrar como Dev" (ou Google, se configurado)

## IA via provedor compativel (OmniRoute)

O backend suporta tanto a API nativa da OpenAI quanto qualquer provedor compativel via `OPENAI_BASE_URL`.

### OpenAI direto

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-nano
```

### OmniRoute ou outro provedor compativel

```env
OPENAI_API_KEY=sk-sua-chave
OPENAI_BASE_URL=https://cloud.omniroute.online/sua-key/v1
OPENAI_MODEL=kr/claude-sonnet-4.5
OPENAI_API_TIMEOUT_MS=60000
```

Quando `OPENAI_BASE_URL` esta preenchido:

- o backend usa a API padrao de Chat Completions (`/chat/completions`)
- o formato de mensagens e `messages: [{ role, content }]`
- compativel com qualquer proxy OpenAI-compatible

Quando `OPENAI_BASE_URL` esta vazio:

- usa a API nativa da OpenAI Responses (`/v1/responses`)
- formato exclusivo da OpenAI com `instructions`, `input`, `text.format`

## Validacao rapida

Depois de subir o backend, valide:

```bash
curl -i http://localhost:8080/health
```

O resultado esperado e `200 OK` com JSON.

Se aparecer `426 Upgrade Required`, voce nao esta falando com o backend correto em `8080`.

## Problemas comuns

### O banco nao bate com o schema atual

Causa:

- o banco nao esta no schema canonico atual
- tabelas esperadas como `event_logs`, `users`, `player_profiles`, `actor_stats` e `chat_messages` nao existem ou estao incompletas

Correcao:

- aplique `backend/database/supabase-schema.sql`
- ou recrie/aline o banco antes de subir o backend

### `426 Upgrade Required`

Causa mais comum:

- existe outro processo escutando na `8080`
- o navegador ou o `curl` esta batendo nesse processo, nao no backend do projeto

Como confirmar:

```bash
curl -i http://localhost:8080/health
netstat -ano | findstr :8080
```

No `netstat`, o que importa e:

- `LISTENING`: processo dono da porta
- `TIME_WAIT`: conexoes antigas; isso nao significa que existem varios servidores

Correcao:

- pare o processo que estiver em `LISTENING` na `8080`
- suba o backend novamente com `npm run start:legacy` (ou `start:api` + `start:worker`)

### `FRONTEND_URL must use localhost... in APP_ENV=local`

Causa:

- `APP_ENV=local` com URL remota

Correcao:

- use `http://localhost:<porta>` no local

### `GOOGLE_REDIRECT_URI must be an absolute URL ending in /auth/callback`

Causa:

- callback configurado com path incorreto

Correcao:

- use exatamente `http://localhost:8080/auth/callback` no local
- ou a mesma porta configurada em `PORT`, por exemplo `http://localhost:8081/auth/callback`

### `Not authenticated` ou retorno para a tela inicial

Causas comuns:

- `FRONTEND_URL` nao bate com a origem real do frontend
- `GOOGLE_REDIRECT_URI` nao bate com o cadastrado no Google Cloud
- o frontend ainda esta apontando para outra porta de API salva em `img_platform_api_url` ou `gardenquest.localApiUrl`
- login feito com conta fora de `ADMIN_GOOGLE_EMAILS` ao acessar o dashboard

Se voce precisou testar a API em outra porta e quer voltar ao fluxo padrao:

```js
localStorage.removeItem('img_platform_api_url');
localStorage.removeItem('gardenquest.localApiUrl');
location.href = 'http://localhost:5500/';
```

## Regras de seguranca importantes

- nunca confie em segredo no frontend
- nunca coloque bypass de auth no frontend
- nunca reutilize credenciais de producao em localhost
- mantenha `COOKIE_SECURE=false` apenas no local
- mantenha `SUPABASE_DB_SSL=true` fora do local
- prefira Secret Manager no deploy de staging/producao

## Relacao com staging e producao

Desenvolvimento local serve para iterar rapido.

Mesmo assim, ele nao substitui um ambiente de `staging`, porque:

- o local nao replica exatamente o proxy do frontend em Cloud Run
- o dominio final muda comportamento de cookie e callback
- configuracoes reais de TLS e origem so aparecem fora do localhost

Recomendacao:

- local para desenvolvimento diario
- staging para validar comportamento proximo da producao
- producao com segredos isolados em Secret Manager

## Validar e executar deploy via script

Mesmo em maquina local, valide o script antes de usar:

```bash
bash -n deploy.sh
```

Formato do comando:

```bash
./deploy.sh <ENV_FILE> <TARGET> <PROJECT_ID> <REGION>
```

Exemplos:

```bash
./deploy.sh .env.staging backend meu-projeto-gcp southamerica-east1
./deploy.sh .env.production all meu-projeto-gcp southamerica-east1
```
