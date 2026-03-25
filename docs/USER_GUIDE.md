# User Guide - GardenQuest Platform

Este guia explica, de forma pratica e passo a passo, como:

1. subir a solucao localmente,
2. acessar a plataforma,
3. usar as funcionalidades principais (hub, jogo e painel admin).

## Leitura rapida (para quem nao e tecnico)

Se voce so quer ver o projeto rodando:

1. Rode `docker compose -f docker-compose.local.yml up -d`
2. Rode `npm --prefix backend run start:api` e `npm --prefix backend run start:worker`
3. Rode `cd frontend/public && python3 -m http.server 5500`
4. Abra `http://localhost:5500`

Se abrir login -> hub -> jogo sem erro, o ambiente esta funcional.

Playbooks detalhados:
- `docs/PLAYBOOK_LOCAL.md`
- `docs/PLAYBOOK_NUVEM.md`

## 1) Pre-requisitos

- Node.js 20+ e npm 10+
- Docker (para banco local)
- Python 3 (para servir frontend estatico)
- Projeto clonado localmente

## 2) Preparar ambiente

1. Copie o arquivo base:

```bash
cp .env.local.example .env.local
```

2. Revise pelo menos:

- `APP_ENV=local`
- `NODE_ENV=development`
- `PORT=8080` (ou outra porta livre)
- `FRONTEND_URL=http://localhost:5500`
- `GOOGLE_REDIRECT_URI=http://localhost:8080/auth/callback`
- `JWT_SECRET=...`
- `SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:5432/gardenquest_dev`
- `ADMIN_GOOGLE_EMAILS=seu-email@dominio.com`

3. Valide ambiente:

```bash
npm --prefix backend run check:env
```

## 3) Subir banco local

```bash
docker compose -f docker-compose.local.yml up -d
```

Se for primeira execucao no banco, aplique o schema:

```bash
psql "$SUPABASE_DB_URL" -f backend/database/supabase-schema.sql
```

Observacao:
- se estiver usando apenas Docker sem `psql` local, execute o mesmo comando via `docker exec` no container do Postgres.

## 4) Rodar backend (modo recomendado)

### Terminal 1 - API

```bash
npm --prefix backend run start:api
```

### Terminal 2 - Worker

```bash
npm --prefix backend run start:worker
```

## 5) Rodar frontend

```bash
cd frontend/public
python3 -m http.server 5500
```

Abra no navegador:

- `http://localhost:5500`

## 6) Se backend nao estiver na porta 8080

Use override de API no frontend:

- `http://localhost:5500/?api=http://localhost:18080`

Esse valor fica salvo no navegador e passa a ser reutilizado.

Para limpar override salvo:

```js
localStorage.removeItem('img_platform_api_url');
localStorage.removeItem('gardenquest.localApiUrl');
```

## 7) Fluxo de uso da plataforma

1. Entre pelo login Google na tela inicial.
2. O sistema redireciona para o `hub`.
3. Clique em `Abrir jogo` no card `Garden Quest`.
4. No jogo, use:
   - `WASD` para mover,
   - mouse para camera,
   - `T` para chat,
   - `Perfil` para apelido/cor,
   - `Voltar ao hub` para retornar.

## 8) Fluxo administrativo (dashboard)

URL:

- `http://localhost:5500/dashboard.html`

Requisitos:

- conta autenticada em `ADMIN_GOOGLE_EMAILS`.

Capacidades:

- visualizar logs de site/jogo,
- visualizar sessoes ativas,
- revogar sessao,
- pausar/retomar agent,
- limpar quarentena de endpoint,
- visualizar dead letters e retry.

## 9) Health checks rapidos

### API

```bash
curl -s http://localhost:8080/health
```

Campos principais esperados no retorno:

- `status`: `ok` ou `degraded`
- `dependencies.database`: disponibilidade/latencia do banco
- `dependencies.queue`: estado da fila de comandos (pending, processing, dead letter)

Exemplo rapido para inspecionar dependencias:

```bash
curl -s http://localhost:8080/health | jq '.status, .dependencies'
```

### Estado publico do jogo

```bash
curl -s http://localhost:8080/api/v1/ai-game/public-state-live
```

### Feed publico de eventos

```bash
curl -s "http://localhost:8080/api/v1/ai-game/public-events?sinceSeq=0&limit=20"
```

## 10) Troubleshooting rapido

### "Acesso negado" no jogo

- confira se cookie de sessao existe,
- confirme `API_URL` correta no browser,
- abra com `?api=http://localhost:SUA_PORTA_API` quando necessario.

### Login redireciona errado

- valide `FRONTEND_URL`,
- valide `GOOGLE_REDIRECT_URI`,
- confira configuracao OAuth no Google Cloud.

### Dashboard retorna 403

- email autenticado nao esta na allowlist admin.
- ajuste `ADMIN_GOOGLE_EMAILS` e reinicie a API.

### Sem atualizacao em tempo real

- verifique se Worker esta ativo,
- verifique `WORLD_EVENT_STREAM_ENABLED=true`,
- verifique conectividade com o Postgres.

## 11) Comandos recomendados de verificacao

```bash
npm --prefix backend run check:env
npm --prefix backend run test:tasks
```

Se os dois comandos passarem e API/Worker estiverem de pe, o ambiente local esta consistente para uso e desenvolvimento.
