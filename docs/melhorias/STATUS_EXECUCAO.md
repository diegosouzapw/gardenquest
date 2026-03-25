# GardenQuest — Status de Execucao das Melhorias

Legenda de status: `nao_iniciada`, `em_andamento`, `bloqueada`, `concluida`

| ID | Fase | Task | Esforco | Dependencias | Status |
|---|---|---|---|---|---|
| 01 | Fase 1 | Corrigir deploy.sh | Baixo | - | concluida |
| 02 | Fase 1 | Sanitizar handler global de erros | Baixo | 01 | concluida |
| 03 | Fase 1 | Forcar HTTPS + cifrar auth_secret | Medio | 02 | concluida |
| 04 | Fase 1 | Remover done do retry admin | Trivial | 03 | concluida |
| 05 | Fase 1 | Condicionar CSP ao ambiente | Trivial | 02 | concluida |
| 06 | Fase 1 | Consolidar bootstrap duplicado | Baixo | 01,02 | concluida |
| 07 | Fase 2 | Unificar autenticacao com sessao revogavel | Medio | 06 | concluida |
| 08 | Fase 2 | CI pipeline minimo | Baixo | 06 | concluida |
| 09 | Fase 2 | ESLint + Prettier | Baixo | 08 | concluida |
| 10 | Fase 2 | Centralizar utilidades duplicadas | Baixo | 09 | concluida |
| 11 | Fase 2 | Reduzir duplicacao frontend | Medio | 10 | concluida |
| 12 | Fase 2 | Refatorar engine.js | Alto | 10,11 | concluida |
| 13 | Fase 3 | Migrar cliente HTTP para undici + retry | Medio | 12 | concluida |
| 14 | Fase 3 | Adotar node-pg-migrate | Medio | 08 | concluida |
| 15 | Fase 3 | Testes de rotas HTTP | Medio | 08,09 | concluida |
| 16 | Fase 3 | Catalogo de erros + correlation-id | Medio | 02,15 | concluida |
| 17 | Fase 3 | OpenAPI spec | Medio | 15,16 | concluida |
| 18 | Fase 3 | JSDoc em servicos publicos | Medio | 12 | concluida |
| 19 | Fase 3 | Graceful shutdown completo | Medio | 06 | concluida |
| 20 | Fase 3 | Health check com DB + queue | Baixo | 19 | concluida |
| 21 | Fase 4 | Consumir deltas no frontend | Medio | 12,16 | concluida |
| 22 | Fase 4 | UX dashboard com modais acessiveis | Baixo | 11 | concluida |
| 23 | Fase 4 | Paginas de erro HTTP dedicadas | Baixo | 16 | concluida |
| 24 | Fase 4 | Testes de integracao e E2E | Alto | 15,17 | concluida |
| 25 | Fase 4 | Limpar artefatos orfaos para archive | Baixo | 24 | concluida |
| 26 | Fase 4 | Prompt versionado e configuravel | Baixo | 13 | concluida |
| 27 | Fase 4 | Limitar SSE subscribers | Baixo | 20 | concluida |
| 28 | Fase 4 | CONTRIBUTING/CHANGELOG/CODEOWNERS | Baixo | 24,25 | concluida |

## Como executar uma task
1. Abrir o arquivo da task em `docs/melhorias/fase-XX/...`.
2. Seguir a ordem de arquivos descrita no item "Ordem de implementacao (arquivo a arquivo)".
3. Executar validacoes da task.
4. Atualizar status nesta tabela.
