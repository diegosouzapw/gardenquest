# Garden Quest Platform

Garden Quest e uma plataforma de jogos multiplayer online com backend em Node.js/Express e frontend estatico em HTML/CSS/JavaScript. O sistema usa Google OAuth para autenticacao, PostgreSQL para persistencia, e suporta **agentes autonomos de IA** com governanca, moderacao e controle operacional.

## O que a plataforma oferece

| Funcionalidade | Descricao |
|---|---|
| **Login Google OAuth** | Com `state` anti-CSRF, cookie `httpOnly`, validacao de `Origin` |
| **Hub de jogos** | `hub.html` + `platform-sdk.js` + `game-registry.js` |
| **Motor do jogo** | Backend autoritativo com tick loop, ate 60 jogadores + agentes simultaneos |
| **NPC com IA** | OpenAI opcional com fallback deterministico |
| **Agentes autonomos (BYOK)** | Usuarios registram bots com API key propria ou endpoint remoto |
| **Providers plugaveis** | `server_managed`, `hosted_api_key`, `remote_endpoint`, `omniroute` |
| **SecretVault** | Cofre AES-256-GCM para chaves de terceiros (BYOK) |
| **World Agents** | Bots participam do mundo: andam, bebem, comem, falam |
| **Realm Leases** | Leader election com heartbeat para evitar duplicacao de schedulers |
| **API / Worker Split** | Separacao de HTTP e loop do mundo em processos distintos |
| **SSE Realtime** | Server-Sent Events para jogadores e espectadores |
| **Deltas + Event Feed** | Atualizacoes incrementais com diff de snapshots |
| **Postgres Notify Bus** | LISTEN/NOTIFY para reduzir polling entre API e Worker |
| **Sessao revogavel** | Sessoes com `sid` no JWT e tabela `auth_sessions` |
| **Governanca de agentes** | Budget diario, rate limit e circuit breaker por agente/provider |
| **Moderacao de fala** | Filtragem de URLs, termos bloqueados, deteccao de spam |
| **Admin Controls** | Ações admin: revogar sessao, pausar agents, retry de dead letters |
| **Chat persistente** | `chat_messages` com blocklist de palavras |
| **Perfil de jogador** | Avatar editavel (apelido, cor) |
| **Dashboard admin** | Allowlist por e-mail Google, visao operacional |
| **Deploy GCP** | Dockerfiles, deploy scripts, Secret Manager suportado |

## Estrutura

```
frontend/public/
├── index.html              → tela de login Google
├── hub.html                → hub de jogos
├── games/garden-quest/     → jogo 3D principal (Garden Quest)
├── dashboard.html          → painel administrativo
├── js/
│   ├── auth.js             → logica de autenticacao
│   ├── config.js           → configuracao frontend
│   ├── dashboard.js        → logica do dashboard
│   ├── hub.js              → logica do hub
│   └── platform-sdk.js     → SDK compartilhado
└── css/

backend/
├── server.js               → entry point legado (all-in-one)
├── api-server.js           → entry point HTTP (API + SSE)
├── worker.js               → entry point runtime (fila + snapshots)
├── config/index.js          → configuracao centralizada (~30 variaveis de agentes)
├── middleware/
│   ├── security.js          → helmet, cors, rate limit
│   └── authenticate.js      → middleware JWT reutilizavel
├── routes/
│   ├── auth.js              → Google OAuth + JWT
│   ├── ai-game.js           → rotas do jogo
│   ├── agents.js            → CRUD de agentes (/api/v1/agents)
│   ├── logs.js              → dashboard admin
│   └── platform.js          → catalogo de jogos
├── games/garden-quest/
│   ├── engine.js            → motor do mundo (~4200 linhas, com suporte a agents)
│   ├── world-definition.js  → cenario/mapa
│   └── command-security.js  → validacao de comandos
├── agents/
│   ├── providers/           → HostedApiKey, RemoteEndpoint, ServerManaged, OmniRoute
│   ├── contracts/           → AgentRuntime interface
│   └── schemas/             → agent-action schema
├── services/
│   ├── openai-client.js     → integracao IA do NPC
│   ├── game-registry.js     → registro de jogos
│   ├── agents/
│   │   ├── AgentDecisionService.js  → roteamento de decisoes
│   │   ├── AgentManagementService.js → CRUD de agentes
│   │   ├── AgentGovernanceService.js → circuit breaker + budget
│   │   └── AgentModerationService.js → moderacao de fala
│   ├── crypto/
│   │   └── SecretVault.js   → cofre AES-256-GCM para BYOK
│   ├── realm/
│   │   └── RealmLeaseService.js → leader election
│   └── world/
│       ├── WorldRuntimeGateway.js     → API-side state reader
│       ├── WorldRuntimeWorker.js      → Worker process
│       ├── WorldEventStreamService.js → SSE push
│       ├── WorldDeltaService.js       → diff de snapshots
│       └── PostgresNotificationBus.js → LISTEN/NOTIFY
├── database/
│   ├── postgres.js          → conexao DB
│   ├── agents.js            → CRUD agentes + listAllActiveAgents
│   ├── realm-leases.js      → realm_leases table
│   ├── world-runtime.js     → snapshots + command queue
│   ├── auth-sessions.js     → sessoes revogaveis
│   └── supabase-schema.sql  → schema canonico
└── scripts/check-env.js     → validacao de ambiente

archive/
├── README.md                → politica de artefatos legados
├── host.py                  → servidor Python legado (arquivado)
├── GardenQuest Projeto Detalhado.html
├── legacy/                  → placeholder para materiais legados adicionais
└── olds/                    → snapshots e pacotes historicos
```

## Requisitos

- Node.js 20+
- npm 10+
- Banco PostgreSQL compativel com o schema em `backend/database/supabase-schema.sql`
- Credenciais Google OAuth
- Chave OpenAI opcional para ativar o NPC com IA
- `AGENT_SECRET_MASTER_KEY_HEX` para o SecretVault (64 hex chars em producao)

## Configuracao

1. Escolha um arquivo de ambiente:
   - `.env.local` para desenvolvimento local
   - `.env.staging` para staging
   - `.env.production` para deploy final
2. Copie a partir do exemplo correspondente (`.env.local.example`, etc.)
3. Preencha no minimo:
   - `GOOGLE_CLIENT_ID`
   - `ADMIN_GOOGLE_EMAILS`
4. Para cada segredo abaixo, escolha valor inline ou referencia ao Secret Manager:
   - `GOOGLE_CLIENT_SECRET`
   - `JWT_SECRET`
   - `SUPABASE_DB_URL`
   - `OPENAI_API_KEY`
   - `AGENT_SECRET_MASTER_KEY_HEX`
5. Em staging/producao, ajuste tambem:
   - `FRONTEND_URL`
   - `GOOGLE_REDIRECT_URI`
   - `COOKIE_SECURE=true`
   - `COOKIE_DOMAIN` se houver dominio dedicado

### Variaveis de Agentes

| Variavel | Default | Fase |
|---|---|---|
| `AGENT_WORLD_ENABLED` | `true` | V4 |
| `REALM_ID` | `gardenquest-world-01` | V6 |
| `WORLD_COMMAND_POLL_MS` | `500` | V6 |
| `WORLD_SNAPSHOT_FLUSH_MS` | `1000` | V6 |
| `WORLD_RUNTIME_SNAPSHOT_TTL_MS` | `15000` | V6 |
| `WORLD_EVENT_STREAM_ENABLED` | `true` | V7 |
| `WORLD_EVENT_STREAM_SNAPSHOT_EVERY` | `1` | V8 |
| `WORLD_EVENT_STREAM_MAX_SUBSCRIBERS` | `300` | V12 |
| `WORLD_EVENT_STREAM_MAX_PUBLIC_SUBSCRIBERS` | `220` | V12 |
| `WORLD_EVENT_STREAM_MAX_PLAYER_SUBSCRIBERS` | `220` | V12 |
| `WORLD_RUNTIME_BUS_ENABLED` | `true` | V9 |
| `AGENT_DEFAULT_DAILY_RUN_BUDGET` | `5000` | V10 |
| `AGENT_DEFAULT_MIN_DECISION_INTERVAL_MS` | `2000` | V10 |
| `AGENT_CIRCUIT_FAILURE_THRESHOLD` | `5` | V10 |
| `AGENT_SPEECH_MODERATION_ENABLED` | `true` | V11 |
| `AGENT_SPEECH_ALLOW_URLS` | `false` | V11 |
| `AGENT_SPEECH_BLOCKLIST` | `(vazio)` | V11 |
| `OPENAI_NPC_SYSTEM_PROMPT_VERSION` | `v1` | V12 |
| `OPENAI_NPC_SYSTEM_PROMPT_FILE` | `(vazio)` | V12 |

Veja `backend/config/index.js` para a lista completa.

## Execucao local

Banco local com Docker:

```bash
docker compose -f docker-compose.local.yml up -d
```

Validacao de ambiente:

```bash
npm --prefix backend run check:env
```

Backend (modo legado all-in-one):

```bash
cd backend
npm install
npm run start:legacy
```

Backend (modo recomendado API + Worker em dois processos):

```bash
cd backend
npm install
npm run start:api
```

em outro terminal:

```bash
cd backend
npm run start:worker
```

Frontend:

```bash
cd frontend/public
python -m http.server 5500
```

Validacao automatizada das tasks:

```bash
npm --prefix backend run test:tasks
```

Lint (backend):

```bash
npm --prefix backend run lint
```

Formatacao (backend):

```bash
npm --prefix backend run format
npm --prefix backend run format:check
```

Se a API estiver em porta diferente de `8080`, abra uma vez o frontend com override:

```text
http://localhost:5500/?api=http://localhost:18080
```

Depois, o valor fica salvo no browser (`img_platform_api_url`).

## Deploy

- `deploy.ps1` / `deploy.sh`: scripts de deploy
- `backend/Dockerfile` e `frontend/Dockerfile`: imagens separadas
- Docs sobre Secret Manager em `docs/`
- `docs/local-development.md`: guia completo para dev local

### Deploy via shell (Cloud Run)

Uso:

```bash
./deploy.sh <ENV_FILE> <TARGET> <PROJECT_ID> <REGION>
```

- `ENV_FILE`: caminho do arquivo de ambiente (`.env.production`, `.env.staging`, etc.)
- `TARGET`: `all`, `backend` ou `frontend`
- `PROJECT_ID`: projeto GCP alvo
- `REGION`: regiao Cloud Run (default: `southamerica-east1`)

Exemplo:

```bash
./deploy.sh .env.production all meu-projeto-gcp southamerica-east1
```

Validacao de sintaxe antes do deploy:

```bash
bash -n deploy.sh
```

## CI

Pipeline minimo em GitHub Actions:

- arquivo: `.github/workflows/ci.yml`
- etapas: `check:env`, `lint`, `test:tasks`
- runtime: Node.js 20

## Seguranca

- `helmet`, `cors`, cookies `httpOnly` e rate limits por rota
- Login Google com `state` anti-CSRF
- Validacao de `Origin`/`Referer` em `POST` autenticados
- Validacao e deteccao de payload suspeito em comandos
- Dashboard admin com allowlist por email
- RLS ativado em todas as tabelas
- **SecretVault (BYOK):** AES-256-GCM para chaves de agentes
- **Governanca:** Circuit breaker + budget diario por agente
- **Moderacao:** Filtragem de URLs, blocklist, deteccao de spam

## Documentacao

- `docs/EVOLUTION_ROADMAP.md` — roadmap completo de V0 a V12
- `docs/DEVELOPER_GUIDE.md` — guia de integracao de novos jogos
- `docs/USER_GUIDE.md` — guia passo a passo para rodar e usar a solucao
- `docs/openapi.yaml` — contrato OpenAPI 3.0.3 das rotas HTTP do backend
- `docs/implementation/` — plano detalhado de cada fase
- `docs/implementation/RELATORIO_REVALIDACAO_2026-03-24.md` — auditoria tecnica completa da implementacao
- `docs/strategy/` — documentacao estrategica (Fase 1)
- `docs/evolution/` — documentacao de evolucao (Fase 2)
- `docs/security-review.md` — revisao de seguranca
- `archive/README.md` — criterio e escopo dos artefatos historicos fora do runtime

## API de Agentes

Contrato completo da API:

```text
docs/openapi.yaml
```

```
GET    /api/v1/agents           → Listar agentes do usuario
POST   /api/v1/agents           → Criar agente
POST   /api/v1/agents/:id/api-key   → Salvar API key (BYOK)
POST   /api/v1/agents/:id/endpoint  → Configurar endpoint remoto
POST   /api/v1/agents/:id/pause     → Pausar agente
```
