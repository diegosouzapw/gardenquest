# GardenQuest — Execucao das Melhorias

## Artefatos de controle
- Checklist por PR: `docs/CHECKLIST_EXECUTAVEL_POR_PR.md`
- Plano mestre: `docs/PLANO_DE_MELHORIAS.md`
- Auditoria consolidada: `docs/AUDITORIA_CONSOLIDADA.md`
- Status de execucao: `docs/melhorias/STATUS_EXECUCAO.md`
- Tasks individuais: `docs/melhorias/fase-XX/task-NN-*.md`

## Regra de trabalho
- Antes de iniciar qualquer task, ler o arquivo da task correspondente.
- Executar seguindo a ordem de arquivos definida na task.
- Atualizar status apos concluir.
- Continuar fase a fase ate 100% das tasks concluidas.

## Backlog (28 tasks)
### Fase 1 — Critico
- [x] 01 Corrigir deploy.sh
- [x] 02 Sanitizar handler global de erros
- [x] 03 Forcar HTTPS em endpoints + cifrar auth_secret
- [x] 04 Remover done de retry admin
- [x] 05 Condicionar CSP ao ambiente
- [x] 06 Consolidar bootstrap duplicado

### Fase 2 — Importante
- [x] 07 Unificar autenticacao com sessao revogavel
- [x] 08 CI pipeline minimo
- [x] 09 ESLint + Prettier
- [x] 10 Centralizar utilidades duplicadas
- [x] 11 Reduzir duplicacao frontend
- [x] 12 Refatorar engine.js

### Fase 3 — Moderado
- [x] 13 Migrar cliente HTTP para undici + retry
- [x] 14 Adotar node-pg-migrate
- [x] 15 Adicionar testes de rotas HTTP
- [x] 16 Catalogo de erros + correlation-id
- [x] 17 OpenAPI spec
- [x] 18 JSDoc em servicos publicos
- [x] 19 Graceful shutdown completo
- [x] 20 Health check com DB + queue

### Fase 4 — Evolucao
- [x] 21 Consumir deltas no frontend
- [x] 22 UX dashboard com modais acessiveis
- [x] 23 Paginas de erro HTTP dedicadas
- [x] 24 Testes de integracao e E2E
- [x] 25 Limpar artefatos orfaos para archive
- [x] 26 Prompt versionado e configuravel
- [x] 27 Limitar SSE subscribers
- [x] 28 CONTRIBUTING/CHANGELOG/CODEOWNERS
