# GardenQuest V12 — Plano de Melhorias

> **Fonte**: [AUDITORIA_CONSOLIDADA.md](./AUDITORIA_CONSOLIDADA.md)
> **Regra de execução**: Antes de iniciar qualquer tarefa, o executor **DEVE** ler o arquivo da task correspondente em `docs/melhorias/fase-XX/task-NN-*.md` para obter o contexto completo, requisitos, critérios de aceite, e código-fonte afetado.

---

## Visão Geral

| Fase | Prioridade | Tasks | Foco |
|---|---|---|---|
| Fase 1 | 🔴 Crítico | 6 | Segurança, deploy, estabilidade |
| Fase 2 | 🟠 Importante | 6 | CI, qualidade, DRY, refatoração |
| Fase 3 | 🟡 Moderado | 8 | Resiliência, documentação, observabilidade |
| Fase 4 | 🟢 Evolução | 8 | UX, delta, testes E2E, organização |
| **Total** | | **28** | |

---

## Fase 1 — Crítico (Execução Imediata)

> Achados que representam risco de segurança, quebra de deploy, ou corrupção de dados.

| # | Task | Achados | Esforço |
|---|---|---|---|
| 01 | [Corrigir `deploy.sh`](./melhorias/fase-01-critico/task-01-corrigir-deploy-sh.md) | AC-38 | Baixo |
| 02 | [Sanitizar handler global de erros](./melhorias/fase-01-critico/task-02-sanitizar-error-handler.md) | AC-09 | Baixo |
| 03 | [Forçar HTTPS em endpoints + cifrar `auth_secret`](./melhorias/fase-01-critico/task-03-https-endpoint-cifrar-secret.md) | AC-20 | Médio |
| 04 | [Remover `done` do retry admin](./melhorias/fase-01-critico/task-04-remover-done-retry-admin.md) | AC-26 | Trivial |
| 05 | [Condicionar CSP ao ambiente](./melhorias/fase-01-critico/task-05-csp-condicional.md) | AC-23, AC-24 | Trivial |
| 06 | [Consolidar bootstrap duplicado](./melhorias/fase-01-critico/task-06-consolidar-bootstrap.md) | AC-02, AC-21, AC-22 | Baixo |

---

## Fase 2 — Importante (Próximo Ciclo)

> Dívida técnica que impacta manutenibilidade, qualidade, e velocidade de desenvolvimento.

| # | Task | Achados | Esforço |
|---|---|---|---|
| 07 | [Unificar autenticação com sessão revogável](./melhorias/fase-02-importante/task-07-unificar-auth.md) | AC-25 | Médio |
| 08 | [CI pipeline mínimo (GitHub Actions)](./melhorias/fase-02-importante/task-08-ci-pipeline.md) | AC-31 | Baixo |
| 09 | [Adicionar ESLint + Prettier](./melhorias/fase-02-importante/task-09-eslint-prettier.md) | AC-10 | Baixo |
| 10 | [Centralizar utilidades duplicadas](./melhorias/fase-02-importante/task-10-centralizar-utilidades.md) | AC-06, AC-12 | Baixo |
| 11 | [Eliminar duplicação frontend](./melhorias/fase-02-importante/task-11-dedup-frontend.md) | AC-07 | Médio |
| 12 | [Refatorar `engine.js` — God Object → módulos](./melhorias/fase-02-importante/task-12-refatorar-engine.md) | AC-01 | Alto |

---

## Fase 3 — Moderado (Ciclos Seguintes)

> Melhorias que aumentam resiliência, documentação, e observabilidade.

| # | Task | Achados | Esforço |
|---|---|---|---|
| 13 | [Substituir `https` nativo por `undici` com retry](./melhorias/fase-03-moderado/task-13-undici-retry.md) | AC-11, AC-32 | Médio |
| 14 | [Adotar `node-pg-migrate` para migrations](./melhorias/fase-03-moderado/task-14-pg-migrate.md) | AC-27 | Médio |
| 15 | [Adicionar testes de rotas HTTP](./melhorias/fase-03-moderado/task-15-testes-rotas.md) | AC-30 | Médio |
| 16 | [Catálogo de erros + correlation-id](./melhorias/fase-03-moderado/task-16-catalogo-erros.md) | AC-43 | Médio |
| 17 | [OpenAPI spec para rotas](./melhorias/fase-03-moderado/task-17-openapi.md) | AC-17 | Médio |
| 18 | [JSDoc nas classes públicas](./melhorias/fase-03-moderado/task-18-jsdoc.md) | AC-16 | Médio |
| 19 | [Graceful shutdown completo](./melhorias/fase-03-moderado/task-19-graceful-shutdown.md) | AC-39 | Médio |
| 20 | [Health check com DB + queue](./melhorias/fase-03-moderado/task-20-health-check.md) | AC-40 | Baixo |

---

## Fase 4 — Evolução Contínua

> Polimento de UX, performance, e organização do repositório.

| # | Task | Achados | Esforço |
|---|---|---|---|
| 21 | [Consumir deltas incrementais no frontend](./melhorias/fase-04-evolucao/task-21-delta-frontend.md) | AC-42 | Médio |
| 22 | [UX dashboard — modais acessíveis](./melhorias/fase-04-evolucao/task-22-ux-dashboard.md) | AC-14 | Baixo |
| 23 | [Páginas de erro HTTP dedicadas](./melhorias/fase-04-evolucao/task-23-paginas-erro.md) | AC-09 | Baixo |
| 24 | [Testes de integração e E2E](./melhorias/fase-04-evolucao/task-24-testes-e2e.md) | AC-30 | Alto |
| 25 | [Limpar artefatos órfãos](./melhorias/fase-04-evolucao/task-25-limpar-orfaos.md) | AC-08 | Baixo |
| 26 | [Prompt versionado e configurável](./melhorias/fase-04-evolucao/task-26-prompt-versionado.md) | AC-34 | Baixo |
| 27 | [Limitar SSE subscribers](./melhorias/fase-04-evolucao/task-27-limitar-sse.md) | AC-41 | Baixo |
| 28 | [CONTRIBUTING/CHANGELOG/CODEOWNERS](./melhorias/fase-04-evolucao/task-28-governance-docs.md) | AC-19 | Baixo |

---

## Regras de Execução

1. **Antes de cada task**: ler o arquivo `docs/melhorias/fase-XX/task-NN-*.md` correspondente
2. **Ordem**: seguir a numeração (tasks dentro da mesma fase podem ser paralelizadas)
3. **Validação**: cada task define critérios de aceite que devem ser verificados antes de marcar como concluída
4. **Regressão**: rodar `npm --prefix backend run test:tasks` após cada task
5. **Documentação**: atualizar este plano marcando `✅` em tasks concluídas
