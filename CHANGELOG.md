# Changelog

Todos os ajustes relevantes deste projeto devem ser registrados neste arquivo.

O formato segue o modelo de [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
e versionamento semantico.

## [Unreleased]

### Added
- Testes de integracao do worker de runtime (`test:integration`).
- Smoke E2E Playwright para fluxo `auth -> hub -> game`.
- Prompt versionado do NPC com suporte a override por ambiente.
- Limites configuraveis para capacidade de subscribers SSE.
- Documentacao de contribuicao (`CONTRIBUTING.md`) e ownership (`CODEOWNERS`).

### Changed
- Artefatos historicos removidos da raiz para reduzir ruido no repositorio.
- Rotas de stream retornam `429` com payload explicativo em saturacao de capacidade.

## [2026-03-25]

### Added
- Plano executavel por PR e tasks individuais consolidados na documentacao do projeto.
- OpenAPI inicial, testes de rotas e validacoes de implementacao.

### Changed
- Melhorias de UX no dashboard admin e paginas de erro dedicadas.
- Evolucao de delta incremental no frontend do jogo.
