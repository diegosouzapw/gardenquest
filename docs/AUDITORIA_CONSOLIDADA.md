# GardenQuest V12 — Auditoria Técnica Consolidada

> **Data**: 24/03/2026
> **Fontes**: Análise Antigravity (9 dimensões, 26 achados) + Relatório Codex (41 entradas, 1541 arquivos auditados)
> **Método**: Cada afirmação ancorada em citação literal de arquivo + linha

---

## Sumário Quantitativo do Repositório

| Métrica | Valor |
|---|---|
| Linhas de código backend (excl. `node_modules`) | ~8.400+ |
| `engine.js` (game core) | 4.371 linhas / 137 KB |
| `game.js` (frontend renderer) | 3.232 linhas |
| `world.js` (frontend scene) | 2.876 linhas |
| Módulos de banco de dados | 5 arquivos / ~2.400 linhas |
| Serviços (agents, crypto, realm, world) | 12 arquivos / ~2.200 linhas |
| Rotas HTTP | 5 arquivos / ~1.290 linhas |
| Testes automatizados | 1 arquivo, 16 testes, 341 linhas |
| Frontend HTML pages | 5 (index, hub, game, game/gq, dashboard) |
| Env vars configuráveis | 60+ |
| Dependências npm (`package.json`) | 8 diretas, 0 vulnerabilidades |
| Entrypoints de processo | 3 (`server.js`, `api-server.js`, `worker.js`) |
| Grafo de `require` backend | 42 files, 117 edges, 0 ciclos |

### Validações executadas durante a auditoria

```
npm --prefix backend run test:tasks     → 16/16 pass
npm --prefix backend run check:env      → sucesso (warnings esperados)
npm --prefix backend audit --omit=dev   → 0 vulnerabilidades
bash -n deploy.sh                       → FALHA de sintaxe
```

---

## Dimensão 1 — Arquitetura e Padrões Estruturais

### Padrão Identificado
**Monólito modular com componentes event-driven** e opção de decomposição por processo.
Não é microservices nem Clean Architecture formal.

Três entrypoints coexistem:
- **`server.js`** (212L): Monolito legado — in-process engine + HTTP (mode: `legacy-monolith`)
- **`api-server.js`** (155L): Stateless API que lê snapshots do DB, enfileira comandos
- **`worker.js`** (88L): Headless worker que consome a fila e executa o game engine

Comunicação API↔Worker via PostgreSQL (`world_command_queue` + `pg_notify`).

### Conformidade SOLID

| Princípio | Conformidade | Violação |
|---|---|---|
| **S** (SRP) | `SecretVault` focado (`SecretVault.js:18-31`) | `engine.js` com 4.371L concentra simulação, scoring, chat, soccer, IA, estado |
| **O** (OCP) | Adapter pattern (`OmniRouteRemoteProvider.js:3`) | `AgentProviderFactory` usa `if/else` encadeado (`AgentProviderFactory.js:11`) |
| **L** (LSP) | Providers implementam `decide` compatível | Sem quebra detectada |
| **I** (ISP) | Contratos leves (`AgentRuntime`) | Rotas dependem diretamente de repos concretos com superfícies amplas (`logs.js:6-8`) |
| **D** (DIP) | DI por construtor nos serviços (`AgentDecisionService.js:16`, `WorldRuntimeWorker.js:22`) | `platform.js:57` faz `jwt.verify` direto sem middleware central |

### Outros Princípios

| Princípio | Estado |
|---|---|
| **DRY** | **Violado**: `auth.js` e `platform-sdk.js` duplicados byte a byte entre `frontend/public/js` e `games/garden-quest/js` |
| **KISS** | **Violado**: heartbeat de 1s com logs de memória em páginas de produção (`index.html:98`, `hub.js:33`) |
| **YAGNI** | **Violado**: snapshots `1-*...12-*` e zips `olds/` no repo operacional |
| **Demeter** | **Violado**: controllers acessam detalhes de infra diretamente |
| **SoC** | **Parcial**: split API/Worker é bom; `routes/logs.js` concentra regras admin sem camada dedicada |

### Achados Consolidados

#### AC-01: God Object `engine.js` — 4.371 linhas [CRÍTICO]
**Evidência**: `engine.js` — toda lógica: física, inventário, combate, soccer, elevadores, arcos, espadas, chat, AI, leaderboard, spawn, morte, pontuação — em um único arquivo de 137 KB com 50+ constantes globais (L31-80).
**Impacto**: Qualquer alteração em combate pode quebrar física ou pontuação. Complexidade ciclomática estimada: 500+.
**Referências**: `engine.js:1-4371`

#### AC-02: Bootstrap duplicado 3x [CRÍTICO]
**Evidência**: Inicialização idêntica de `SecretVault`, `AgentManagementService`, e tabelas de banco repetida em:
- `server.js:21-34`
- `api-server.js:24-34`
- `worker.js:13-23`

Incluindo master key fallback hardcoded `'0123456789abcdef...'` em cada uma.

#### AC-03: Factory por `if/else` [MODERADO]
**Evidência**: `AgentProviderFactory.js:11` — inclusão de novo provider requer edição do factory central (OCP parcial).
**Recomendação**: Registry pattern com auto-discovery ou map declarativo.

---

## Dimensão 2 — Estrutura de Pastas e Organização

### Estrutura Atual

```
/
├── backend/
│   ├── agents/contracts/  (1 stub: AgentRuntime.js — 153 bytes)
│   ├── agents/providers/  (4 providers + adapters/)
│   ├── agents/schemas/    (1 file: agent-action.js)
│   ├── config/            (1 file: index.js — 515L)
│   ├── database/          (6 files incl. supabase-schema.sql morto)
│   ├── games/garden-quest/ (3 files — engine 137KB)
│   ├── middleware/         (2 files)
│   ├── routes/            (5 files)
│   ├── scripts/           (1 file)
│   ├── services/          (4 subdirs + 2 loose files)
│   ├── tests/             (1 file)
│   ├── server.js / api-server.js / worker.js
│   └── package.json
├── frontend/public/
│   ├── index.html / hub.html / dashboard.html / game.html
│   ├── games/garden-quest/ (index.html + js/ + css/)
│   ├── css/ (stylesheets compartilhados)
│   └── js/ (auth.js, hub.js, dashboard.js, platform-sdk.js)
├── docs/ (roadmap, guias, implementation/)
├── 1-* a 12-* (snapshots históricos)
├── olds/ (zips legados)
├── deploy.sh / deploy.ps1
├── docker-compose.local.yml
├── host.py (servidor alternativo Python)
└── GardenQuest Projeto Detalhado.html
```

### Proposta de Clean Architecture para o Backend

```
backend/
├── src/
│   ├── domain/                      ← Entidades e regras de negócio puras
│   │   ├── game/
│   │   │   ├── PhysicsEngine.js
│   │   │   ├── InventorySystem.js
│   │   │   ├── CombatSystem.js
│   │   │   ├── SoccerSubgame.js
│   │   │   ├── PlayerLifecycle.js
│   │   │   ├── LeaderboardManager.js
│   │   │   ├── ChatManager.js
│   │   │   ├── WorldDefinition.js
│   │   │   └── constants.js
│   │   ├── agent/
│   │   │   ├── AgentDecisionService.js
│   │   │   ├── AgentGovernanceService.js
│   │   │   ├── AgentModerationService.js
│   │   │   └── AgentWorldScheduler.js
│   │   └── realm/
│   │       └── RealmLeaseService.js
│   │
│   ├── application/                 ← Casos de uso / orquestração
│   │   ├── bootstrap.js             ← Factory unificada (elimina 3x duplicação)
│   │   ├── GameOrchestrator.js      ← Orquestra domain game
│   │   └── AgentOrchestrator.js     ← Orquestra domain agent
│   │
│   ├── infrastructure/              ← Adaptadores de I/O
│   │   ├── database/
│   │   │   ├── postgres.js
│   │   │   ├── agents.js
│   │   │   ├── auth-sessions.js
│   │   │   ├── realm-leases.js
│   │   │   ├── world-runtime.js
│   │   │   └── migrations/         ← node-pg-migrate
│   │   ├── providers/
│   │   │   ├── AgentProviderRegistry.js   ← Registry pattern
│   │   │   ├── HostedApiKeyProvider.js
│   │   │   ├── RemoteEndpointProvider.js
│   │   │   ├── ServerManagedNpcProvider.js
│   │   │   └── adapters/
│   │   ├── crypto/
│   │   │   └── SecretVault.js
│   │   ├── bus/
│   │   │   └── PostgresNotificationBus.js
│   │   ├── http/
│   │   │   └── OpenAiClient.js     ← undici com retry
│   │   └── streaming/
│   │       ├── WorldEventStreamService.js
│   │       └── WorldDeltaService.js
│   │
│   ├── interfaces/                  ← Camada de apresentação
│   │   ├── http/
│   │   │   ├── routes/
│   │   │   │   ├── auth.js
│   │   │   │   ├── ai-game.js
│   │   │   │   ├── agents.js
│   │   │   │   ├── platform.js
│   │   │   │   └── admin.js
│   │   │   ├── middleware/
│   │   │   │   ├── authenticate.js
│   │   │   │   ├── security.js
│   │   │   │   └── error-handler.js  ← handler centralizado
│   │   │   └── validators/
│   │   │       └── command-security.js
│   │   └── gateway/
│   │       ├── WorldRuntimeGateway.js
│   │       └── WorldRuntimeWorker.js
│   │
│   └── shared/                      ← Utilitários transversais
│       ├── normalize.js             ← Centralizar normalizeText, normalizeEmail, etc.
│       ├── request.js               ← getRequestIp, parseUserAgent
│       ├── errors.js                ← Catálogo de erros + ErrorWithCode
│       └── logger.js
│
├── server.js                        ← Entrypoint legado (thin)
├── api-server.js                    ← Entrypoint API (thin, usa bootstrap)
├── worker.js                        ← Entrypoint Worker (thin, usa bootstrap)
├── package.json
└── .eslintrc.js / .prettierrc
```

### Proposta de Clean Structure para o Frontend

```
frontend/public/
├── shared/                          ← Módulos compartilhados (1 cópia)
│   ├── css/
│   │   ├── variables.css
│   │   ├── base.css
│   │   └── components.css
│   ├── js/
│   │   ├── auth.js                  ← Cópia única (elimina duplicação)
│   │   ├── platform-sdk.js          ← Cópia única
│   │   ├── config.js
│   │   └── api-client.js
│   └── assets/
│
├── pages/
│   ├── index.html
│   ├── hub.html
│   ├── dashboard.html
│   └── errors/
│       ├── 404.html
│       ├── 500.html
│       └── offline.html
│
├── games/
│   └── garden-quest/
│       ├── index.html
│       ├── css/
│       ├── js/
│       │   ├── game.js             ← Refatorado: render + input
│       │   ├── world.js            ← Refatorado: scene setup
│       │   ├── player.js
│       │   ├── network.js          ← SSE + fetch separados
│       │   └── ui.js               ← HUD, menus, chat
│       └── assets/
│
└── service-worker.js (futuro)
```

### Achados de Estrutura

#### AC-04: Stub morto `AgentRuntime.js` [BAIXO]
**Evidência**: `agents/contracts/AgentRuntime.js` — 153 bytes, classe com `throw new Error('Not implemented')`. Nenhum provider estende esta classe.

#### AC-05: `supabase-schema.sql` morto no runtime [BAIXO]
**Evidência**: Schema é definido via `CREATE TABLE IF NOT EXISTS` dentro de `ensure*Tables()`. O SQL nunca é executado automaticamente.

#### AC-06: Utilidades duplicadas em 6+ arquivos [MODERADO]
**Evidência**: `getRequestIp()` definido separadamente em `routes/auth.js:22-26`, `routes/ai-game.js:7-11`, `routes/platform.js:11-15`, `routes/logs.js:10-14`, `middleware/authenticate.js:5-16`, `middleware/security.js:56-63`.

#### AC-07: Duplicação frontend byte a byte [IMPORTANTE]
**Evidência**: `auth.js` e `platform-sdk.js` idênticos (MD5 iguais) entre `frontend/public/js/` e `frontend/public/games/garden-quest/js/`.

#### AC-08: Artefatos órfãos no repositório [MODERADO]
**Evidência**: `host.py` (servidor Python alternativo), `GardenQuest Projeto Detalhado.html` (export de chat), `olds/*.zip`, snapshots `1-*..12-*` — todos no mesmo repo de produção.

---

## Dimensão 3 — Qualidade do Código-Fonte

### Pontos Fortes

| Controle | Evidência |
|---|---|
| Input sanitization (11 regras) | `command-security.js:6-51` — XSS, SQLi, path traversal, shell injection, template injection |
| Unicode whitelists | `command-security.js:1-3` — `CHAT_ALLOWED_CHAR_PATTERN`, `PROFILE_NICKNAME_ALLOWED_CHAR_PATTERN` |
| Normalização defensiva | Toda entrada passa por `normalizeText()`, `Math.max/Math.min`, tipo-checagem |
| 100% parameterized queries | Zero concatenação de strings em SQL em todo o codebase |
| Config validation | `config/index.js:438+` — validação exaustiva de env por ambiente |
| Zero secrets hardcoded detectáveis | Scan por regex de chaves comuns retornou vazio |

### Achados

#### AC-09: Handler global de erro expõe `err.message` [CRÍTICO]
**Evidência**:
- `server.js:146`: `res.status(status).json({ error: String(err.message || 'Internal server error') })`
- `api-server.js:119`: mesmo padrão

**Impacto**: Em produção, erros internos (stack traces, nomes de tabela, queries) podem vazar para o cliente.

**Correção proposta**:
```javascript
app.use((err, req, res, next) => {
  const status = Number(err.statusCode) || 500;
  const publicMessage = err.publicMessage || (status >= 500 ? 'Internal server error' : 'Request failed');
  const errorId = crypto.randomUUID();
  console.error('[error]', { errorId, status, path: req.originalUrl, message: err.message });
  res.status(status).json({ error: publicMessage, errorId });
});
```

#### AC-10: Ausência de linting/formatting [IMPORTANTE]
**Evidência**: Nenhum `.eslintrc`, `.prettierrc`, `biome.json` no repositório. `package.json:6` não contém scripts lint/format.

#### AC-11: `openai-client.js` usa `https` nativo [IMPORTANTE]
**Evidência**: `openai-client.js:136-189` — implementação manual de HTTP client com chunk buffering. Sem retries, connection pooling, keep-alive, HTTP/2, ou compressão gzip.

#### AC-12: `normalizeInteger` definido em 3+ arquivos [MODERADO]
**Evidência**: Helper identico em `AgentGovernanceService.js:3-9`, `AgentDecisionService.js`, `config/index.js`.

#### AC-13: Frontend com arquivos excessivamente longos [IMPORTANTE]
**Evidência**: `game.js` 3.232L, `world.js` 2.876L — baixa coesão, mesclam render, input, network, e UI.

#### AC-14: UX admin usa `alert/confirm` nativo [MODERADO]
**Evidência**: `dashboard.js:267`, `dashboard.js:393` — ações críticas (revogar sessão, bloquear agente) com `window.confirm`.

#### AC-15: Logs de diagnóstico ruidosos em produção [BAIXO]
**Evidência**: `index.html:98`, `hub.js:33` — heartbeat de 1s com logs de memória em páginas públicas.

---

## Dimensão 4 — Qualidade de Documentação

### Estado Atual
- **README.md** (9 KB): Atualizado para V12, setup, scripts, estrutura.
- **docs/EVOLUTION_ROADMAP.md**: 12 fases documentadas.
- **docs/DEVELOPER_GUIDE.md**: Runtime modes, checklist de integração, observabilidade.
- **docs/USER_GUIDE.md**: Guia passo a passo.
- **docs/implementation/**: Plano por fase + tracker + relatório de revalidação.

### Achados

#### AC-16: Ausência de JSDoc/TSDoc [MODERADO]
**Evidência**: Zero funções nos 40+ arquivos backend possuem JSDoc. Classes como `AgentGovernanceService`, `WorldEventStreamService` não documentam parâmetros ou retornos.

#### AC-17: Ausência de API reference (OpenAPI) [MODERADO]
**Evidência**: 5 rotas, 20+ endpoints sem documentação formal. Nenhum arquivo OpenAPI, Swagger, ou Postman.

#### AC-18: Inconsistência factual entre docs [IMPORTANTE]
**Evidência**: Relatório `RELATORIO_REVALIDACAO_2026-03-24.md:34` afirma 100% concluído, mas tasks individuais em `fase-07-sse-realtime/task-01-world-event-stream.md:3` marcadas como "Não iniciada".

#### AC-19: Ausência de CONTRIBUTING/CHANGELOG/CODEOWNERS [BAIXO]
**Evidência**: Nenhum destes arquivos existe no repositório.

---

## Dimensão 5 — Segurança

### Controles Implementados (Excelentes)

| Controle | Implementação | Evidência |
|---|---|---|
| OAuth State CSRF | Nonce 32 bytes + timing-safe comparison | `auth.js:84-97` |
| Secret Vault | AES-256-GCM com IV randômico por operação | `SecretVault.js:18-28` |
| Rate Limiting | 5 tiers: global, auth, admin, AI state, AI command | `security.js:188-240` |
| RLS Database | `USING (false)` bloqueia `anon`/`authenticated` | `postgres.js:84-112` |
| Cookie Security | `httpOnly`, `secure`, `sameSite`, domain validation | `auth.js:165-174` |
| Origin Verification | Manual para unsafe methods | `security.js:161-186` |
| SQL Injection | 100% parameterized queries | Todo o codebase |

### Achados

#### AC-20: Endpoint remoto aceita `http` e `auth_secret` em texto puro [CRÍTICO]
**Evidência**:
- `AgentManagementService.js:131` — `baseUrl` aceita qualquer protocolo
- `agents.js:65` — coluna `auth_secret text` em `agent_endpoints` sem cifração
- `supabase-schema.sql:226` — confirma schema
**Impacto**: Credenciais de endpoints remotos armazenadas em plaintext. MitM possível via HTTP.

#### AC-21: Master key fallback hardcoded `'0123456789...'` [ALTO]
**Evidência**: `server.js:22-24`, `api-server.js:24-27`, `worker.js:13-16` — chave default previsível, replicada 3x.

#### AC-22: JWT `dev-secret-change-me` em desenvolvimento [ALTO]
**Evidência**: `config/index.js:335-338` — se deploy acidental com `NODE_ENV=development`, JWTs seriam forjáveis.

#### AC-23: CSP `connectSrc` inclui `localhost` incondicionalmente [MODERADO]
**Evidência**: `security.js:119` — `connectSrc: ["'self'", 'http://localhost:8080', 'http://127.0.0.1:8080', frontendOrigin]` — não filtrado por `NODE_ENV`.

#### AC-24: CORS permissivo demais em desenvolvimento [MODERADO]
**Evidência**: `security.js:144` — permite todos origins em `development`.

#### AC-25: Autenticação inconsistente em `platform.js` [IMPORTANTE]
**Evidência**: `platform.js:57` usa `jwt.verify` direto sem validar sessão ativa/revogada, enquanto `authenticate.js:83` faz a validação completa.

#### AC-26: Retry admin aceita reprocessar comando `done` [CRÍTICO]
**Evidência**: `world-runtime.js:621` — `AND status IN ('dead_letter', 'error', 'done')` permite re-executar comandos já concluídos.

---

## Dimensão 6 — Banco de Dados e Persistência

### Pontos Fortes
- Schema evolution idempotente via `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- Row Level Security aplicado automaticamente
- Transações explícitas em `upsertWorldRuntimeSnapshot()` com `BEGIN/COMMIT/ROLLBACK`
- Command queue com deduplication (unique index parcial em `dedupe_key`)
- Dead letter queue com retry manual via admin
- Leader election via CAS atômico (`realm_leases`)

### Achados

#### AC-27: Schema sem migration framework [ALTO]
**Evidência**: `agents.js:38-41`, `agents.js:93-104`, `world-runtime.js:134-152` — múltiplos `ALTER TABLE IF NOT EXISTS` sem versionamento, rollback, ou auditoria de mudanças.

#### AC-28: Pool sem health checks [MODERADO]
**Evidência**: `postgres.js:61-66` — `max: 10` sem `connectionTimeoutMillis`, `statement_timeout`, ou `query_timeout`.

#### AC-29: Cleanup dentro de transação de snapshot [MODERADO]
**Evidência**: `world-runtime.js:281-297` — `DELETE FROM` stale data dentro da transação de snapshot pode causar latência.

---

## Dimensão 7 — Testes e Qualidade de Entrega

### Estado Atual

| Métrica | Valor |
|---|---|
| Testes | 16 (1 arquivo) |
| Framework | `node:test` (built-in) |
| Cobertura estimada | ~5-8% |
| JS total (backend + frontend) | 22.773 linhas |
| Linhas de teste | 341 |
| CI pipeline | **Inexistente** |

### Cobertura de testes por serviço

| Componente | Testado? |
|---|---|
| `AgentWorldScheduler` | ✅ 4 testes |
| `RealmLeaseService` | ✅ 1 teste |
| `SecretVault` | ✅ 2 testes |
| `AgentDecisionService` | ✅ 1 teste |
| `decodeAuthToken` | ✅ 2 testes |
| `AgentGovernanceService` | ✅ 2 testes |
| `AgentModerationService` | ✅ 1 teste |
| `WorldRuntimeWorker` | ✅ 2 testes |
| `WorldEventStreamService` | ✅ 1 teste |
| Rotas HTTP | ❌ Zero |
| Middleware | ❌ Zero |
| Database layer | ❌ Zero |
| Game engine (4.371L) | ❌ Zero |
| OpenAI client | ❌ Zero |
| Frontend | ❌ Zero |

#### AC-30: Cobertura < 10% [CRÍTICO]
**Recomendação**: Implementar testes para rotas (supertest), engine (unitários dos módulos extraídos), e smoke E2E.

#### AC-31: Sem CI pipeline [IMPORTANTE]
**Evidência**: Sem `.github/workflows/`, `Jenkinsfile`, ou equivalente.

---

## Dimensão 8 — LLM Gateway e Integração com IA

### Arquitetura

```
AgentDecisionService
  ├── AgentGovernanceService (rate limit + circuit breaker por agente e provider)
  ├── AgentProviderFactory → seleciona por mode/provider
  │   ├── ServerManagedNpcProvider → openai-client.js → OpenAI Responses API
  │   ├── HostedApiKeyProvider → SecretVault + OpenAI API
  │   └── RemoteEndpointProvider → external HTTP (com adapter OmniRoute)
  └── AgentModerationService (URL, blocklist, spam)
```

### Pontos Fortes
- Multi-provider factory com BYOK (Bring Your Own Key)
- Dual circuit breaker (per-agent + per-provider) em `AgentGovernanceService.js`
- Daily budget enforcement persistido no DB
- Content moderation (URL filtering, blocklist, repetição, truncation)
- Token estimation e auditoria per-run no `agent_usage_daily`
- Endpoint quarantine com thresholds configuráveis
- Adapter pattern para providers customizados (`OmniRouteRemoteProvider`)

### Achados

#### AC-32: Sem retry automático para chamadas LLM [ALTO]
**Evidência**: `openai-client.js:116-134` — `parseRetryAfterSeconds` é implementado mas **nunca consumido**. O `retryAfterSeconds` é colocado em `OpenAiHttpError` mas nenhum caller faz re-scheduling.

#### AC-33: Schema de decision hardcoded [MODERADO]
**Evidência**: `openai-client.js:14-31` — `DECISION_SCHEMA` hardcoded. Sem sincronia automática com engine.

#### AC-34: Prompt do sistema não versionado [MODERADO]
**Evidência**: `openai-client.js:33-50` — `SYSTEM_PROMPT` hardcoded como array de strings. Requer deploy para mudança.

#### AC-35: Circuit breaker em memória de processo [IMPORTANTE]
**Evidência**: `AgentGovernanceService.js:27-28` — `this.agentState = new Map()`. Em multi-instância, cada worker tem estado independente.

#### AC-36: Falta guardrails de prompt injection [MODERADO]
**Evidência**: Sem filtros de prompt injection indireta, exfiltração por tools, ou redação PII.

#### AC-37: Falta tracing distribuído [MODERADO]
**Evidência**: Sem `traceparent`, correlation-id, p95/p99, ou custo por tenant/modelo.

---

## Dimensão 9 — Fluxos End-to-End e Resiliência

### Jornada 1: Login OAuth (Bem implementado)
```
Browser → GET /auth/google → state nonce cookie → Google OAuth
Google → GET /auth/callback → timing-safe verify → exchange code → userinfo
→ upsertUser → createAuthSession → JWT com sid → httpOnly cookie → redirect
```

### Jornada 2: Comando de jogo
```
Frontend → POST /api/v1/ai-game/command → validatePlayerCommandBody
→ worldGateway.enqueuePlayerCommand → world_command_queue
→ pg_notify('world_command_bus')
→ Worker: WorldRuntimeWorker.processCommandBatch → engine.applyPlayerCommand
→ exportRuntimeState → upsertWorldRuntimeSnapshot
→ pg_notify('world_runtime_bus')
→ API: WorldEventStreamService → SSE push
```

### Jornada 3: Decisão de agente IA
```
Worker tick → AgentWorldScheduler.maybeSyncWorldAgents → listRunnableAgents
→ AgentDecisionService.decideForAgent
  → GovernanceService.assertCanRun (circuit, rate limit, budget)
  → ProviderFactory.createProvider(mode).decide(observation)
  → ModerationService.moderateDecision (URL, blocklist, spam)
  → recordAgentRun + endpoint health tracking
  → engine.applyAgentDecision
```

### Achados de Resiliência

#### AC-38: `deploy.sh` quebrado [CRÍTICO]
**Evidência**: `bash -n deploy.sh` → falha de sintaxe. `deploy.sh:195`, `deploy.sh:240` — fim sem `fi`, fluxo backend incompleto.

#### AC-39: Sem graceful shutdown completo [ALTO]
**Evidência**: `server.js:201-209` — `process.on('SIGINT')` chama `release()` mas não aguarda drain de conexões HTTP, flush de snapshots, ou conclusão de timers.

#### AC-40: Sem health check de dependências [MODERADO]
**Evidência**: `/health` retorna `ok` sem verificar: conectividade PostgreSQL, latência OpenAI, backlog da command queue.

#### AC-41: SSE sem limite de subscribers [MODERADO]
**Evidência**: `WorldEventStreamService` — `this.subscribers = new Map()` sem cap. Ataque de resources pode esgotar file descriptors.

#### AC-42: Cliente não consome deltas incrementais [IMPORTANTE]
**Evidência**: `game.js:1941` — ao receber evento `delta`, faz full fetch em vez de aplicar diff.

#### AC-43: Falta catálogo formal de erros e correlation-id [IMPORTANTE]
**Evidência**: Sem correlação entre erro de usuário e logs do backend.

---

## Veredito Final

O GardenQuest V12 demonstra **maturidade acima da média** em:
- Segurança (timing-safe CSRF, AES-256-GCM, RLS, parameterized queries, 5 tier rate limiting)
- CQRS-lite (command queue com deduplication, leader election, pg_notify bus)
- Resiliência de agentes (dual circuit breaker, quarantine, daily budget, moderation)

Os déficits críticos concentram-se em:
1. **`engine.js` de 4.371 linhas** — maior risco técnico
2. **Cobertura de testes < 10%** — refatoração cega
3. **Segurança operacional** — `deploy.sh` quebrado, error handler expõe internals, `auth_secret` em texto puro

Total: **43 achados** (8 Críticos, 10 Importantes/Altos, 15 Moderados, 10 Baixos)
