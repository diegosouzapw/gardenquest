# Task 11 — Reduzir duplicacao frontend

## Metadados
- Fase: fase-02-importante
- Prioridade: Importante
- Esforco estimado: Medio
- Dependencias: 10
- Status: concluida

## Contexto
Esta task foi derivada de `docs/AUDITORIA_CONSOLIDADA.md` e `docs/PLANO_DE_MELHORIAS.md`.
Objetivo: Reduzir duplicacao frontend.

## Ordem de implementacao (arquivo a arquivo)
1. `frontend/public/shared/js/auth.js`
2. `frontend/public/shared/js/platform-sdk.js`
3. `frontend/public/index.html`
4. `frontend/public/hub.html`
5. `frontend/public/dashboard.html`
6. `frontend/public/games/garden-quest/index.html`

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
