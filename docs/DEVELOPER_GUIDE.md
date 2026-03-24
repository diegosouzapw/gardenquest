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
3. **Backend**: Importe o motor e monte a rota no `server.js`

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
