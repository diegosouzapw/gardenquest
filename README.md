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
├── game.html               → jogo 3D (Three.js)
├── dashboard.html          → painel administrativo
├── js/
│   ├── auth.js             → logica de autenticacao
│   ├── config.js           → configuracao frontend
│   ├── dashboard.js        → logica do dashboard
│   ├── hub.js              → logica do hub
│   └── platform-sdk.js     → SDK compartilhado
└── css/

backend/
├── server.js               → entry point monolitico (all-in-one)
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
| `WORLD_EVENT_STREAM_ENABLED` | `true` | V7 |
| `AGENT_DEFAULT_DAILY_RUN_BUDGET` | `5000` | V10 |
| `AGENT_DEFAULT_MIN_DECISION_INTERVAL_MS` | `2000` | V10 |
| `AGENT_CIRCUIT_FAILURE_THRESHOLD` | `5` | V10 |
| `AGENT_SPEECH_MODERATION_ENABLED` | `true` | V11 |
| `AGENT_SPEECH_ALLOW_URLS` | `false` | V11 |
| `AGENT_SPEECH_BLOCKLIST` | `(vazio)` | V11 |

Veja `backend/config/index.js` para a lista completa.

## Execucao local

Banco local com Docker:

```bash
docker compose -f docker-compose.local.yml up -d
```

Backend:

```bash
cd backend
npm install
node server.js
```

Frontend:

```bash
cd frontend/public
python -m http.server 5500
```

## Deploy

- `deploy.ps1` / `deploy.sh`: scripts de deploy
- `backend/Dockerfile` e `frontend/Dockerfile`: imagens separadas
- Docs sobre Secret Manager em `docs/`
- `docs/local-development.md`: guia completo para dev local

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
- `docs/implementation/` — plano detalhado de cada fase
- `docs/strategy/` — documentacao estrategica (Fase 1)
- `docs/evolution/` — documentacao de evolucao (Fase 2)
- `docs/security-review.md` — revisao de seguranca

## API de Agentes

```
GET    /api/v1/agents           → Listar agentes do usuario
POST   /api/v1/agents           → Criar agente
POST   /api/v1/agents/:id/api-key   → Salvar API key (BYOK)
POST   /api/v1/agents/:id/endpoint  → Configurar endpoint remoto
POST   /api/v1/agents/:id/pause     → Pausar agente
```
