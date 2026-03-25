# Guia de Desenvolvimento e Integração (GardenQuest Platform)

Este documento é a fonte única de verdade para criar e integrar novos jogos na plataforma.

## 1. Arquitetura Modular

Cada jogo deve ser um módulo independente, pronto para ser movido para seu próprio repositório Git.

### Estrutura de Pastas
- **Frontend**: `frontend/public/games/[slug]/` — `index.html`, `js/`, `css/`, `assets/`
- **Backend**: `backend/games/[slug]/` — `engine.js`, `command-security.js`, `world-definition.js`

---

## 2. Integração de Repositórios Externos

Para manter um jogo em um repositório Git separado:
```text
meu-jogo-repo/
  ├── web/      (Conteúdo → frontend/public/games/)
  └── api/      (Conteúdo → backend/games/)
```

Pode usar **Git Submodules** ou **symlinks** para mapear as pastas.

---

## 3. Passo a Passo de Integração

1. **Registro**: Adicione o jogo em `backend/services/game-registry.js`
2. **Frontend**: Configure `window.PLATFORM_GAME_CONFIG` no `index.html`
3. **Backend**: Importe o motor e monte a rota no `api-server.js` (ou `server.js` no modo legado)

---

## 4. Sistemas Disponíveis (V12)

O backend agora oferece sistemas que novos jogos podem utilizar:

| Sistema | Módulo | Uso |
|---|---|---|
| **Agentes IA** | `AgentDecisionService` | Bots autônomos no mundo do jogo |
| **BYOK** | `SecretVault` | Usuários trazem suas próprias API keys |
| **Governança** | `AgentGovernanceService` | Circuit breaker + budget diário |
| **Moderação** | `AgentModerationService` | Filtragem de fala de agentes |
| **Realm Lease** | `RealmLeaseService` | Leader election para múltiplas instâncias |
| **SSE** | `WorldEventStreamService` | Push de estado em tempo real |
| **Deltas** | `WorldDeltaService` | Atualizações incrementais |
| **Command Queue** | `WorldRuntimeWorker` | Fila de comandos processada pelo Worker |
| **Notify Bus** | `PostgresNotificationBus` | LISTEN/NOTIFY entre processos |
| **Sessão** | `auth-sessions.js` | Sessões revogáveis com auditoria |

---

## 5. Performance e Banco de Dados

> [!IMPORTANT]
> **NÃO grave no banco em tempo real** para ações frequentes (score, comida, movimento).

- **Throttling**: Persista stats apenas na **morte** ou **logout**
- **Logs**: Use `logEvent` apenas para eventos críticos
- **Snapshots**: O `WorldRuntimeWorker` cuida de persistir snapshots periodicamente

---

## 6. Prevenção de Memory Leaks

WebGL exige limpeza profunda ao sair do jogo:
- **Deep Disposal**: `.dispose()` em geometrias, materiais e texturas
- **Context Loss**: Use `WEBGL_lose_context` para liberar a GPU
- **Navegação**: Use `window.location.replace('/hub.html?ref=game_exit')`

---

## 7. SDK da Plataforma (`Platform`)

- `Platform.requireAuth()`: Garante que o usuário está logado
- `Platform.backToHub()`: Retorna ao Hub limpando a sessão
- `Platform.trackEvent()`: Registra métricas de engajamento
- `Platform.openGame(slug)`: Abre jogo e preserva override de API quando aplicável (`?api=...`)

---

## 8. Modos de Runtime

### Modo recomendado (V12)
- `npm --prefix backend run start:api`
- `npm --prefix backend run start:worker`

### Modo legado
- `npm --prefix backend run start:legacy`

Regras:
- novos jogos devem ser compatíveis com modo API/Worker;
- o legado existe para compatibilidade e rollback.

---

## 9. Checklist de Integração de Novo Jogo

1. Registrar jogo em `backend/services/game-registry.js`.
2. Expor `window.PLATFORM_GAME_CONFIG` no `index.html` do jogo.
3. Garantir `apiBasePath` e rotas backend do jogo.
4. Implementar proteção auth (`Platform.requireAuth`).
5. Implementar retorno seguro ao hub (`Platform.backToHub`).
6. Garantir limpeza de recursos WebGL ao sair.
7. Garantir fallback de API via `?api=` e storage `img_platform_api_url`.

---

## 10. Validacao Minima Obrigatoria

Antes de merge:

```bash
npm --prefix backend run check:env
npm --prefix backend run test:tasks
```

Smoke manual:
1. `index -> hub -> jogo`.
2. Canvas renderizando sem erro fatal.
3. `Voltar ao hub -> abrir jogo novamente`.
4. Sem regressao de auth/cookie (`/auth/me` com 200).

Para ambientes com API em porta nao padrao:
- abrir frontend com `?api=http://localhost:SUA_PORTA_API`.

---

## 11. Observabilidade Operacional

- `/health`: estado do runtime e lease.
- `/api/v1/system/dashboard`: logs institucionais.
- `/api/v1/system/ops-dashboard`: sessoes, fila, estado de agentes.
- dashboard web: `frontend/public/dashboard.html`.

---

## 12. Contrato HTTP (OpenAPI)

- Arquivo canonico do contrato: `docs/openapi.yaml`.
- Sempre que uma rota, payload ou codigo de erro mudar em `backend/routes/*`, atualize a spec no mesmo PR.
- Regra pratica: nao mergear alteracao de API sem diff correspondente em `docs/openapi.yaml`.

---

## 13. Governanca de contribuicao

- Processo de contribuicao: `CONTRIBUTING.md`.
- Historico de mudancas: `CHANGELOG.md`.
- Ownership de revisao: `CODEOWNERS`.

Regras praticas:
1. Toda mudanca funcional relevante deve atualizar o `CHANGELOG.md`.
2. PR sem validacoes minimas (`check:env`, `lint`, `test:tasks`) nao deve ser mergeado.
3. Mudancas de API exigem update de `docs/openapi.yaml` no mesmo PR.
