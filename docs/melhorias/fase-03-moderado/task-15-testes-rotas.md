# Task 15 — Adicionar testes de rotas HTTP (supertest)

## Metadados
- Fase: fase-03-moderado
- Prioridade: Moderado
- Esforco estimado: Medio
- Dependencias: 08,09
- Status: concluida

## Contexto
Esta task foi derivada de `docs/AUDITORIA_CONSOLIDADA.md` e `docs/PLANO_DE_MELHORIAS.md`.
Objetivo: Adicionar testes de rotas HTTP (supertest).

## Ordem de implementacao (arquivo a arquivo)
1. `backend/tests/routes/auth.test.js`
2. `backend/tests/routes/ai-game.test.js`
3. `backend/tests/routes/platform.test.js`
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
