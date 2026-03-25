# Task 14 — Adotar node-pg-migrate para migrations

## Metadados
- Fase: fase-03-moderado
- Prioridade: Moderado
- Esforco estimado: Medio
- Dependencias: 08
- Status: concluida

## Contexto
Esta task foi derivada de `docs/AUDITORIA_CONSOLIDADA.md` e `docs/PLANO_DE_MELHORIAS.md`.
Objetivo: Adotar node-pg-migrate para migrations.

## Ordem de implementacao (arquivo a arquivo)
1. `backend/migrations/0001-init.js`
2. `backend/migrations/0002-agent-endpoints.js`
3. `backend/database/postgres.js`
4. `backend/package.json`

## Passos tecnicos executaveis
1. Abrir os arquivos na ordem acima e aplicar as alteracoes minimas necessarias para cumprir o objetivo da task.
2. Preservar compatibilidade retroativa das rotas e contratos existentes quando aplicavel.
3. Incluir ou atualizar testes relacionados ao comportamento alterado.
4. Atualizar documentacao impactada (README/docs locais) quando houver alteracao de fluxo/comando/configuracao.

## Criterios de aceite
- Comportamento alvo implementado sem regressao funcional conhecida.
- Validacoes automatizadas executadas com sucesso no escopo da task.
- Sem vazamento de segredos, sem hardcode de credenciais, sem quebra de lint/teste (quando configurados).

## Validacao obrigatoria
```bash
npm --prefix backend run check:env
npm --prefix backend run test:tasks
```

## Atualizacoes de controle
- Atualizar status em `docs/melhorias/STATUS_EXECUCAO.md`
- Referenciar esta task no PR correspondente em `docs/CHECKLIST_EXECUTAVEL_POR_PR.md`
