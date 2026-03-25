# Prompts do NPC

Este diretorio guarda prompts versionados usados pelo provider `server_managed`.

## Convencao
- Arquivo padrao: `npc-system-v{N}.md`
- Versao ativa por default: `v1`
- Override opcional por variavel de ambiente:
  - `OPENAI_NPC_SYSTEM_PROMPT_VERSION` (ex.: `v1`, `v2`)
  - `OPENAI_NPC_SYSTEM_PROMPT_FILE` (caminho relativo ao repo ou absoluto)

## Regras
- Manter linguagem objetiva e focada em comportamento do jogo.
- Evitar informacoes de infraestrutura/segredos no prompt.
- Quando criar nova versao, nao sobrescrever a anterior: adicionar novo arquivo.
- Validar com `npm --prefix backend run test:tasks` apos qualquer mudanca.
