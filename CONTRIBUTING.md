# Contributing Guide

Obrigado por contribuir com o GardenQuest Platform.

## Escopo
- Este repositorio combina backend (`backend/`), frontend estatico (`frontend/public/`) e documentacao (`docs/`).
- Toda alteracao deve preservar compatibilidade de rotas e contratos existentes, salvo quando houver mudanca explicitamente planejada.

## Fluxo de trabalho
1. Crie branch a partir de `main` (ou `master`) com nome descritivo:
   - `feat/<tema>`
   - `fix/<tema>`
   - `docs/<tema>`
   - `chore/<tema>`
2. Faça commits pequenos e objetivos.
3. Abra PR com resumo tecnico e validacoes executadas.

## Convencao de commit
Use Conventional Commits sempre que possivel:
- `feat: ...`
- `fix: ...`
- `refactor: ...`
- `docs: ...`
- `test: ...`
- `chore: ...`

## Validacao minima obrigatoria
Execute antes de abrir PR:

```bash
npm --prefix backend run check:env
npm --prefix backend run lint
npm --prefix backend run test:tasks
```

Quando a mudanca afetar rotas, filas ou streaming, execute tambem:

```bash
npm --prefix backend run test:routes
npm --prefix backend run test:integration
```

Quando houver mudancas em fluxo de UI principal:

```bash
npm --prefix backend run test:e2e
```

## Regras para PR
- Descreva claramente problema, solucao e risco.
- Liste arquivos alterados e impacto esperado.
- Inclua plano de rollback quando houver mudanca sensivel.
- Atualize documentacao relacionada no mesmo PR.
- Se houver mudanca de contrato HTTP, atualize `docs/openapi.yaml`.

## Seguranca e segredos
- Nunca commitar segredos, tokens ou chaves.
- Use variaveis de ambiente e secret manager.
- Evite logs com payload sensivel.

## Changelog e release
- Atualize `CHANGELOG.md` para mudancas relevantes de comportamento.
- Agrupe entradas em `Unreleased` antes de tag/release.
