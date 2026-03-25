# GardenQuest — Checklist Executavel por PR

## Objetivo
Transformar o plano de melhorias em execucao rastreavel por Pull Request, com ordem de implementacao arquivo a arquivo, estimativa de esforco e dependencia entre tarefas.

## Regra operacional (obrigatoria)
1. Antes de iniciar qualquer tarefa, ler o arquivo da task em `docs/melhorias/fase-XX/...`.
2. Executar uma task por vez (ou tasks independentes em paralelo somente dentro da mesma fase).
3. Atualizar status no arquivo `docs/melhorias/STATUS_EXECUCAO.md` ao finalizar.
4. Rodar validacoes minimas ao final de cada task:
   - `npm --prefix backend run check:env`
   - `npm --prefix backend run test:tasks`
5. Nao avancar para fase seguinte com itens pendentes da fase atual, exceto itens explicitamente marcados como bloqueados.

## Sequencia por PR

### PR-01 — Estabilizacao Critica de Deploy e Erro
- Tasks: 01, 02
- Esforco estimado: 0.5 a 1.0 dia
- Ordem:
  1. `deploy.sh`
  2. `backend/server.js`
  3. `backend/api-server.js`

### PR-02 — Seguranca de Endpoint e Retry
- Tasks: 03, 04, 05
- Esforco estimado: 1.0 a 2.0 dias
- Ordem:
  1. `backend/services/agents/AgentManagementService.js`
  2. `backend/database/agents.js`
  3. `backend/database/supabase-schema.sql`
  4. `backend/database/world-runtime.js`
  5. `backend/middleware/security.js`

### PR-03 — Bootstrap e Autenticacao Unificada
- Tasks: 06, 07
- Esforco estimado: 1.0 a 1.5 dias
- Ordem:
  1. `backend/bootstrap/runtime-bootstrap.js` (novo)
  2. `backend/server.js`
  3. `backend/api-server.js`
  4. `backend/worker.js`
  5. `backend/routes/platform.js`

### PR-04 — Esteira de Qualidade (CI + Lint + Format)
- Tasks: 08, 09
- Esforco estimado: 0.5 a 1.0 dia
- Ordem:
  1. `.github/workflows/ci.yml` (novo)
  2. `.eslintrc.cjs` (novo)
  3. `.prettierrc` (novo)
  4. `backend/package.json`

### PR-05 — Reducao de Duplicacao
- Tasks: 10, 11
- Esforco estimado: 1.0 a 2.0 dias
- Ordem:
  1. `backend/shared/*.js` (novos)
  2. `backend/routes/*.js`
  3. `frontend/public/shared/js/*.js` (novos)
  4. `frontend/public/*.html`
  5. `frontend/public/games/garden-quest/index.html`

### PR-06 — Refatoracao do Core do Jogo
- Task: 12
- Esforco estimado: 3 a 6 dias
- Ordem:
  1. `backend/games/garden-quest/systems/*.js` (novos)
  2. `backend/games/garden-quest/engine.js`
  3. testes de regressao do core

### PR-07 — Resiliencia de Cliente HTTP e Migrations
- Tasks: 13, 14
- Esforco estimado: 1.5 a 3 dias
- Ordem:
  1. `backend/services/openai-client.js`
  2. providers remotos
  3. `backend/migrations/*` (novo)
  4. `backend/database/*.js`

### PR-08 — Observabilidade de Erros e Contrato de API
- Tasks: 16, 17
- Esforco estimado: 1.5 a 3 dias
- Ordem:
  1. `backend/shared/errors.js` (novo)
  2. `backend/middleware/request-context.js` (novo)
  3. `backend/routes/*.js`
  4. `docs/openapi.yaml` (novo)

### PR-09 — Testes HTTP e E2E
- Tasks: 15, 24
- Esforco estimado: 2 a 4 dias
- Status: concluido (tasks 15 e 24 concluidas)
- Ordem:
  1. `backend/tests/routes/*.test.js` (novo)
  2. `e2e/playwright/*.spec.ts` (novo)
  3. scripts de testes no `backend/package.json`

### PR-10 — Estabilidade Operacional
- Tasks: 19, 20, 27
- Esforco estimado: 1 a 2 dias
- Status: concluido (tasks 19, 20 e 27 concluidas)
- Ordem:
  1. `backend/server.js`
  2. `backend/api-server.js`
  3. `backend/worker.js`
  4. `backend/services/world/WorldEventStreamService.js`

### PR-11 — Evolucao de UX
- Tasks: 21, 22, 23
- Esforco estimado: 1.5 a 3 dias
- Status: concluido (tasks 21, 22 e 23 concluidas)
- Ordem:
  1. `frontend/public/games/garden-quest/js/game.js`
  2. `frontend/public/dashboard.html`
  3. `frontend/public/js/dashboard.js`
  4. `frontend/public/errors/*.html` (novos)

### PR-12 — Governanca de Documentacao e Repositorio
- Tasks: 18, 25, 26, 28
- Esforco estimado: 1 a 2 dias
- Status: concluido (tasks 18, 25, 26 e 28 concluidas)
- Ordem:
  1. `backend/prompts/*` (novos)
  2. limpeza de artefatos para `archive/`
  3. `CONTRIBUTING.md`, `CHANGELOG.md`, `CODEOWNERS` (novos)
  4. atualizacao de guias em `docs/`

## Status Consolidado
- PRs concluidos: 12/12
- Tasks concluidas: 28/28
- Proxima etapa: consolidar commit(s) e abrir PR final de fechamento.

## Mapa de tasks
- Fonte mestre: `docs/PLANO_DE_MELHORIAS.md`
- Controle de execucao: `docs/melhorias/STATUS_EXECUCAO.md`
- Contexto individual: `docs/melhorias/fase-XX/task-NN-*.md`

## Definicao de pronto (DoD)
- Implementacao concluida conforme criterios da task.
- Testes e checks minimos executados sem regressao.
- Documentacao da tarefa atualizada.
- Status marcado como concluido no tracker.
