# Documentacao do Projeto (GardenQuest)

Este diretorio contem a **documentacao ativa** do projeto.

## Comece por aqui

- Se voce quer apenas usar/rodar o sistema: `USER_GUIDE.md`
- Se voce vai desenvolver localmente: `LOCAL_DEVELOPMENT.md`
- Se voce vai contribuir com codigo: `DEVELOPER_GUIDE.md` + `../CONTRIBUTING.md`
- Se voce precisa do contrato da API: `OPENAPI.yaml`
- Se voce quer runbook operacional passo a passo:
  - `PLAYBOOK_LOCAL.md`
  - `PLAYBOOK_NUVEM.md`

## Mapa rapido

- `USER_GUIDE.md`: fluxo de uso (login, hub, jogo, dashboard)
- `LOCAL_DEVELOPMENT.md`: setup local com variaveis e troubleshooting
- `DEVELOPER_GUIDE.md`: arquitetura, runtime e checklist tecnico
- `PLAYBOOK_LOCAL.md`: runbook detalhado para subir local
- `PLAYBOOK_NUVEM.md`: runbook detalhado para deploy em nuvem
- `OPENAPI.yaml`: especificacao oficial das rotas HTTP
- `SECURITY_REVIEW.md`: decisoes e postura de seguranca
- `GOOGLE_CLIENT_SECRET_MANAGER.md`: configuracao segura do segredo OAuth Google
- `JWT_SECRET_MANAGER.md`: configuracao segura do segredo JWT
- `OPENAI_SECRET_MANAGER.md`: configuracao segura da chave da OpenAI
- `SUPABASE_SECRET_MANAGER.md`: configuracao segura da credencial de banco/Supabase
- `AUDITORIA_CONSOLIDADA.md`: auditoria tecnica consolidada
- `PLANO_DE_MELHORIAS.md`: plano de melhorias (finalizado)
- `CHECKLIST_EXECUTAVEL_POR_PR.md`: execucao por PR (finalizada)
- `TASK.md`: status final consolidado do backlog de melhorias

## Convencao de nomes

Na raiz de `docs/`, os arquivos seguem o padrao `NOME_MAIUSCULO.ext`
para facilitar busca visual e padronizacao.
