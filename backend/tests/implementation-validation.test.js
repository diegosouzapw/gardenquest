const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const supertest = require('supertest');

const config = require('../config');
const createAiGameRoutes = require('../routes/ai-game');
const { AgentWorldScheduler } = require('../services/agents/AgentWorldScheduler');
const { RealmLeaseService } = require('../services/realm/RealmLeaseService');
const { SecretVault } = require('../services/crypto/SecretVault');
const { resolveNpcSystemPrompt, DEFAULT_NPC_SYSTEM_PROMPT } = require('../services/openai-client');
const { AgentDecisionService } = require('../services/agents/AgentDecisionService');
const { AgentGovernanceService } = require('../services/agents/AgentGovernanceService');
const { AgentModerationService } = require('../services/agents/AgentModerationService');
const { AgentManagementService } = require('../services/agents/AgentManagementService');
const { WorldEventStreamService } = require('../services/world/WorldEventStreamService');
const { WorldRuntimeWorker, classifyWorkerCommandError } = require('../services/world/WorldRuntimeWorker');
const { WorldRuntimeGateway } = require('../services/world/WorldRuntimeGateway');
const { buildSnapshotDelta } = require('../services/world/WorldDeltaService');
const { ADMIN_RETRYABLE_WORLD_COMMAND_STATUSES } = require('../database/world-runtime');
const {
  LOCAL_FALLBACK_AGENT_SECRET_MASTER_KEY_HEX,
  createRuntimeSecretVault,
  initializeRuntimeDatabase,
  resolveAgentSecretMasterKeyHex,
} = require('../bootstrap/runtime-bootstrap');
const { decodeAuthToken, toAuthRequestUser } = require('../middleware/authenticate');
const { buildErrorResponse, createAppError } = require('../shared/errors');
const { requestContext, normalizeCorrelationId } = require('../middleware/request-context');

function waitNextTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('scheduler runs sync callback when schedulers are enabled', async () => {
  let calls = 0;
  const scheduler = new AgentWorldScheduler({
    canRunSchedulers: () => true,
    syncWorldAgents: async () => { calls += 1; },
  });

  const accepted = scheduler.maybeSyncWorldAgents();
  await waitNextTick();

  assert.equal(accepted, true);
  assert.equal(calls, 1);
});

test('scheduler skips sync callback when schedulers are disabled', async () => {
  let calls = 0;
  const scheduler = new AgentWorldScheduler({
    canRunSchedulers: () => false,
    syncWorldAgents: async () => { calls += 1; },
  });

  const accepted = scheduler.maybeSyncWorldAgents();
  await waitNextTick();

  assert.equal(accepted, false);
  assert.equal(calls, 0);
});

test('scheduler runs decision callback when schedulers are enabled', async () => {
  let calls = 0;
  const scheduler = new AgentWorldScheduler({
    canRunSchedulers: () => true,
    requestAgentDecisions: async () => { calls += 1; },
  });

  const accepted = scheduler.maybeRequestAgentDecisions();
  await waitNextTick();

  assert.equal(accepted, true);
  assert.equal(calls, 1);
});

test('scheduler skips decision callback when schedulers are disabled', async () => {
  let calls = 0;
  const scheduler = new AgentWorldScheduler({
    canRunSchedulers: () => false,
    requestAgentDecisions: async () => { calls += 1; },
  });

  const accepted = scheduler.maybeRequestAgentDecisions();
  await waitNextTick();

  assert.equal(accepted, false);
  assert.equal(calls, 0);
});

test('realm lease service emits acquired and lost callbacks on leadership transitions', async () => {
  const events = [];
  let ownerInstanceId = 'instance-a';

  const realmService = new RealmLeaseService({
    realmId: 'realm-test',
    ownerInstanceId: 'instance-a',
    leaseTtlMs: 7000,
    realmRepository: {
      async acquireOrRenewRealmLease({ realmId, ownerInstanceId: localOwner, leaseToken, expiresAt }) {
        return {
          realmId,
          ownerInstanceId,
          leaseToken: ownerInstanceId === localOwner ? leaseToken : 'remote-token',
          expiresAt: expiresAt.toISOString(),
          renewedAt: new Date().toISOString(),
          acquiredAt: new Date().toISOString(),
          metaJson: {},
        };
      },
    },
    onLeaseAcquired: () => events.push('acquired'),
    onLeaseLost: () => events.push('lost'),
    logger: { info() {}, warn() {}, error() {} },
  });

  await realmService.heartbeat();
  await waitNextTick();
  assert.equal(realmService.isLeader(), true);

  ownerInstanceId = 'instance-b';
  await realmService.heartbeat();
  await waitNextTick();
  assert.equal(realmService.isLeader(), false);
  assert.deepEqual(events, ['acquired', 'lost']);
});

test('secret vault encrypts and decrypts agent secrets with same fingerprint', async () => {
  let stored = null;
  const vault = new SecretVault({
    masterKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    agentRepository: {
      async saveAgentSecret(payload) {
        stored = payload;
      },
      async getAgentSecret() {
        return stored;
      },
    },
  });

  const saved = await vault.storeAgentSecret('agent-01', 'super-secret-value');
  const revealed = await vault.getAgentSecret('agent-01');

  assert.equal(revealed, 'super-secret-value');
  assert.equal(saved.fingerprint, vault.buildFingerprint('super-secret-value'));
});

test('secret vault rejects invalid master key length', () => {
  assert.throws(
    () => new SecretVault({ masterKeyHex: 'abcd', agentRepository: {} }),
    /must decode to 32 bytes/
  );
});

test('secret vault encryptSecret and decryptPayload work as a generic primitive', () => {
  const vault = new SecretVault({
    masterKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    agentRepository: {},
  });

  const encrypted = vault.encryptSecret('  endpoint-token-123  ');
  const revealed = vault.decryptPayload(encrypted.payload);

  assert.equal(revealed, 'endpoint-token-123');
  assert.equal(encrypted.fingerprint, vault.buildFingerprint('endpoint-token-123'));
});

test('openai client loads versioned npc prompt from backend/prompts', () => {
  const previousVersion = config.OPENAI_NPC_SYSTEM_PROMPT_VERSION;
  const previousFile = config.OPENAI_NPC_SYSTEM_PROMPT_FILE;

  try {
    config.OPENAI_NPC_SYSTEM_PROMPT_VERSION = 'v1';
    config.OPENAI_NPC_SYSTEM_PROMPT_FILE = '';

    const resolved = resolveNpcSystemPrompt({
      forceReload: true,
      logger: { warn() {} },
    });

    assert.equal(resolved.version, 'v1');
    assert.equal(resolved.source, 'file');
    assert.ok(resolved.instructions.includes('server-authoritative multiplayer garden game'));
  } finally {
    config.OPENAI_NPC_SYSTEM_PROMPT_VERSION = previousVersion;
    config.OPENAI_NPC_SYSTEM_PROMPT_FILE = previousFile;
  }
});

test('openai client falls back to embedded prompt when configured file does not exist', () => {
  const previousVersion = config.OPENAI_NPC_SYSTEM_PROMPT_VERSION;
  const previousFile = config.OPENAI_NPC_SYSTEM_PROMPT_FILE;

  try {
    config.OPENAI_NPC_SYSTEM_PROMPT_VERSION = 'v404';
    config.OPENAI_NPC_SYSTEM_PROMPT_FILE = 'backend/prompts/missing-npc-prompt.md';

    const resolved = resolveNpcSystemPrompt({
      forceReload: true,
      logger: { warn() {} },
    });

    assert.equal(resolved.source, 'fallback');
    assert.equal(resolved.instructions, DEFAULT_NPC_SYSTEM_PROMPT);
  } finally {
    config.OPENAI_NPC_SYSTEM_PROMPT_VERSION = previousVersion;
    config.OPENAI_NPC_SYSTEM_PROMPT_FILE = previousFile;
  }
});

test('agent management service rejects endpoint URLs without https', async () => {
  let savedEndpoint = null;
  const service = new AgentManagementService({
    secretVault: null,
    agentRepository: {
      async getAgentByIdForOwner() {
        return { id: 'agent-01', ownerUserId: 'user-01', mode: 'remote_endpoint' };
      },
      async getAgentEndpointByAgentId() {
        return null;
      },
      async saveAgentEndpoint(payload) {
        savedEndpoint = payload;
      },
    },
  });

  await assert.rejects(
    service.configureEndpoint({
      ownerUserId: 'user-01',
      agentId: 'agent-01',
      endpoint: { baseUrl: 'http://insecure.example.com' },
    }),
    (error) => error && error.statusCode === 400 && /https/i.test(error.message)
  );
  assert.equal(savedEndpoint, null);
});

test('agent management service stores bearer endpoint secret as encrypted payload', async () => {
  let savedEndpoint = null;
  const vault = new SecretVault({
    masterKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    agentRepository: {},
  });
  const service = new AgentManagementService({
    secretVault: vault,
    agentRepository: {
      async getAgentByIdForOwner() {
        return { id: 'agent-02', ownerUserId: 'user-01', mode: 'remote_endpoint' };
      },
      async getAgentEndpointByAgentId() {
        return null;
      },
      async saveAgentEndpoint(payload) {
        savedEndpoint = payload;
      },
    },
  });

  await service.configureEndpoint({
    ownerUserId: 'user-01',
    agentId: 'agent-02',
    endpoint: {
      baseUrl: 'https://api.example.com/agent',
      authMode: 'bearer',
      authSecret: 'endpoint-secret-token',
      timeoutMs: 2400,
    },
  });

  assert.ok(savedEndpoint);
  assert.equal(savedEndpoint.authMode, 'bearer');
  assert.ok(savedEndpoint.authSecretPayload);
  assert.ok(savedEndpoint.authSecretFingerprint);
  assert.equal(savedEndpoint.authSecretPayload.includes('endpoint-secret-token'), false);
});

test('agent decision service returns fallback when governance blocks execution', async () => {
  const recorded = [];
  const repository = {
    async getAgentById() {
      return {
        id: 'agent-01',
        status: 'active',
        mode: 'server_managed',
        provider: 'openai',
        policyJson: { dailyRunBudget: 1, minDecisionIntervalMs: 1000 },
      };
    },
    async getAgentDailyUsage() {
      return { runCount: 5 };
    },
    async recordAgentRun(run) {
      recorded.push(run);
    },
  };

  const service = new AgentDecisionService({
    agentRepository: repository,
    logger: { error() {}, warn() {}, info() {} },
  });

  const decision = await service.decideForAgent({
    agentId: 'agent-01',
    observation: { self: { status: 'idle' } },
    fallbackDecisionFactory: () => ({ action: 'wait', targetId: null, speech: null }),
  });

  assert.equal(decision.action, 'wait');
  assert.equal(decision.meta?.provider, 'governance');
  assert.equal(recorded[0]?.status, 'blocked');
});

test('decodeAuthToken returns normalized user data with sid', () => {
  const token = jwt.sign(
    { id: 'user-01', name: 'Gardener', email: 'User@Example.com', sid: 'session-01' },
    config.JWT_SECRET,
    { expiresIn: '2m' }
  );

  const decoded = decodeAuthToken(token);
  assert.equal(decoded.id, 'user-01');
  assert.equal(decoded.name, 'Gardener');
  assert.equal(decoded.email, 'user@example.com');
  assert.equal(decoded.sessionId, 'session-01');
});

test('decodeAuthToken rejects payloads without user id', () => {
  const token = jwt.sign(
    { name: 'Gardener', sid: 'session-01' },
    config.JWT_SECRET,
    { expiresIn: '2m' }
  );

  const decoded = decodeAuthToken(token);
  assert.equal(decoded, null);
});

test('toAuthRequestUser keeps sessionId and sid synchronized', () => {
  const mapped = toAuthRequestUser({
    id: 'user-01',
    name: 'Gardener',
    email: 'user@example.com',
    picture: 'https://example.com/avatar.png',
    sessionId: 'session-01',
  });

  assert.equal(mapped.id, 'user-01');
  assert.equal(mapped.sessionId, 'session-01');
  assert.equal(mapped.sid, 'session-01');
});

test('governance enforces per-agent decision interval', async () => {
  let nowMs = 10_000;
  const governance = new AgentGovernanceService({
    now: () => nowMs,
    logger: { warn() {}, error() {}, info() {} },
    agentRepository: {
      async getAgentDailyUsage() {
        return { runCount: 0 };
      },
      async getAgentEndpointHealthByAgentId() {
        return null;
      },
    },
  });

  const agent = {
    id: 'agent-01',
    mode: 'server_managed',
    provider: 'openai',
    policyJson: {
      dailyRunBudget: 100,
      minDecisionIntervalMs: 1500,
    },
  };

  await governance.assertCanRun({ agent });
  await assert.rejects(
    governance.assertCanRun({ agent }),
    (error) => error && error.code === 'agent_rate_limited'
  );

  nowMs += 2000;
  await governance.assertCanRun({ agent });
});

test('governance opens agent circuit after repeated failures', () => {
  let nowMs = 20_000;
  const governance = new AgentGovernanceService({
    now: () => nowMs,
    logger: { warn() {}, error() {}, info() {} },
    agentRepository: null,
  });

  const agent = {
    id: 'agent-circuit',
    mode: 'server_managed',
    provider: 'openai',
    policyJson: {
      failureThreshold: 2,
      cooldownMs: 5000,
      providerFailureThreshold: 99,
      providerCooldownMs: 5000,
    },
  };
  const policy = governance.getPolicy(agent);

  const firstError = new Error('first');
  firstError.code = 'provider_error';
  const secondError = new Error('second');
  secondError.code = 'provider_error';

  governance.onFailure({ agent, providerKey: 'server_managed:openai', error: firstError, policy });
  governance.onFailure({ agent, providerKey: 'server_managed:openai', error: secondError, policy });

  const state = governance.agentState.get('agent-circuit');
  assert.ok(state);
  assert.ok(state.openUntil > nowMs);
});

test('moderation blocks external links and marks response as suspicious', () => {
  const moderation = new AgentModerationService({
    logger: { warn() {}, error() {}, info() {} },
  });

  const result = moderation.moderateDecision({
    agent: { id: 'agent-01' },
    decision: { action: 'wait', speech: 'Acesse https://exemplo.com agora' },
  });

  assert.equal(result.decision.speech, null);
  assert.equal(result.moderation.blocked, true);
  assert.equal(result.moderation.suspicious, true);
  assert.equal(result.moderation.flags[0]?.code, 'external_link');
});

test('worker command classifier marks validation errors as non-retryable', () => {
  const error = new Error('invalid command');
  error.code = 'validation_error';

  const plan = classifyWorkerCommandError(error, { attempts: 1 });
  assert.equal(plan.retryable, false);
  assert.equal(plan.delayMs, 0);
});

test('worker command classifier applies exponential backoff for generic errors', () => {
  const error = new Error('temporary backend issue');
  error.code = 'temporary_error';

  const first = classifyWorkerCommandError(error, { attempts: 1 });
  const third = classifyWorkerCommandError(error, { attempts: 3 });

  assert.equal(first.retryable, true);
  assert.equal(third.retryable, true);
  assert.ok(third.delayMs > first.delayMs);
});

test('admin retry policy does not include done commands', () => {
  assert.deepEqual(ADMIN_RETRYABLE_WORLD_COMMAND_STATUSES, ['dead_letter', 'error']);
  assert.equal(ADMIN_RETRYABLE_WORLD_COMMAND_STATUSES.includes('done'), false);
});

test('runtime bootstrap resolves local fallback secret key when env key is absent', () => {
  const key = resolveAgentSecretMasterKeyHex({
    appEnv: 'local',
    env: {},
  });
  assert.equal(key, LOCAL_FALLBACK_AGENT_SECRET_MASTER_KEY_HEX);
});

test('runtime bootstrap returns null secret vault outside local when key is absent', () => {
  const vault = createRuntimeSecretVault({
    appEnv: 'production',
    env: {},
    agentRepository: {},
  });
  assert.equal(vault, null);
});

test('runtime bootstrap initializes all configured repositories', async () => {
  const calls = [];

  await initializeRuntimeDatabase({
    verifyDatabaseConnection: async () => calls.push('verify-db'),
    agentRepository: {
      async ensureAgentTables() {
        calls.push('agents');
      },
    },
    authSessionRepository: {
      async ensureAuthSessionTable() {
        calls.push('auth-sessions');
      },
    },
    realmRepository: {
      async ensureRealmLeaseTable() {
        calls.push('realm');
      },
    },
    worldRuntimeRepository: {
      async ensureWorldRuntimeTables() {
        calls.push('world-runtime');
      },
    },
  });

  assert.deepEqual(calls, ['verify-db', 'agents', 'auth-sessions', 'realm', 'world-runtime']);
});

test('world event stream wakes up immediately on runtime bus notifications', async () => {
  const service = new WorldEventStreamService({
    realmId: 'realm-01',
    worldRuntimeRepository: {
      async getLatestWorldRuntimeSnapshot() {
        return null;
      },
      async listWorldRuntimeEvents() {
        return [];
      },
    },
    worldGateway: {
      hydrateSnapshotState() {
        return {};
      },
      async touchPlayerSession() {},
    },
    logger: { error() {}, warn() {}, info() {} },
  });

  service.subscribers.set('s1', { kind: 'public', res: { writableEnded: true, destroyed: true } });
  let polled = 0;
  service.poll = async () => { polled += 1; };

  const startedAt = Date.now();
  await service.handleRuntimeNotification({ realmId: 'realm-01' });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(polled, 1);
  assert.equal(service.busNotifications, 1);
  assert.equal(service.busWakeups, 1);
  assert.ok(elapsedMs < 50);
});

test('snapshot delta includes all dynamic world collections when they change', () => {
  const previousSnapshot = {
    world: {
      trees: [{ id: 'tree-01', applesRemaining: 2 }],
      droppedApples: [{ id: 'apple-01' }],
      swords: [{ id: 'sword-01' }],
      bows: [{ id: 'bow-01', arrowsRemaining: 2 }],
      arrows: [{ id: 'arrow-01' }],
      elevators: [{ id: 'tower-west', y: 11.8, state: 'idle_top' }],
      graves: [{ id: 'grave-01' }],
      soccer: { ball: { position: { x: 0, y: 0.42, z: 0 } } },
      bounds: 45,
    },
  };

  const nextSnapshot = {
    serverTime: '2026-01-01T00:00:00.000Z',
    tick: 99,
    world: {
      trees: [{ id: 'tree-01', applesRemaining: 1 }],
      droppedApples: [{ id: 'apple-02' }],
      swords: [],
      bows: [{ id: 'bow-01', arrowsRemaining: 1 }],
      arrows: [{ id: 'arrow-02' }],
      elevators: [{ id: 'tower-west', y: 0, state: 'idle_bottom' }],
      graves: [{ id: 'grave-02' }],
      soccer: { ball: { position: { x: 4, y: 0.42, z: -10 } } },
      bounds: 50,
    },
  };

  const delta = buildSnapshotDelta(previousSnapshot, nextSnapshot);

  assert.equal(delta.tick, 99);
  assert.deepEqual(delta.world?.trees, nextSnapshot.world.trees);
  assert.deepEqual(delta.world?.droppedApples, nextSnapshot.world.droppedApples);
  assert.deepEqual(delta.world?.swords, nextSnapshot.world.swords);
  assert.deepEqual(delta.world?.bows, nextSnapshot.world.bows);
  assert.deepEqual(delta.world?.arrows, nextSnapshot.world.arrows);
  assert.deepEqual(delta.world?.elevators, nextSnapshot.world.elevators);
  assert.deepEqual(delta.world?.graves, nextSnapshot.world.graves);
  assert.deepEqual(delta.world?.soccer, nextSnapshot.world.soccer);
  assert.equal(delta.world?.bounds, 50);
});

test('buildErrorResponse includes catalog metadata and correlation id', () => {
  const { statusCode, payload, appError } = buildErrorResponse(
    createAppError('invalid_session'),
    { correlationId: 'corr-1234' }
  );

  assert.equal(statusCode, 401);
  assert.equal(appError.code, 'invalid_session');
  assert.equal(payload.error, 'Invalid, expired, or revoked session');
  assert.equal(payload.code, 'invalid_session');
  assert.equal(payload.errorId, 'corr-1234');
  assert.equal(payload.correlationId, 'corr-1234');
});

test('buildErrorResponse uses fallback code for non-app errors', () => {
  const { statusCode, payload } = buildErrorResponse(
    new Error('invalid payload'),
    {
      fallbackCode: 'validation_failed',
      correlationId: 'corr-5678',
    }
  );

  assert.equal(statusCode, 400);
  assert.equal(payload.error, 'Validation failed');
  assert.equal(payload.code, 'validation_failed');
  assert.equal(payload.correlationId, 'corr-5678');
});

test('requestContext keeps valid incoming x-correlation-id', () => {
  const req = {
    headers: {
      'x-correlation-id': 'client-corr-0001',
    },
  };
  const responseHeaders = {};
  const res = {
    locals: {},
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value;
    },
  };
  let nextCalled = false;

  requestContext(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.correlationId, 'client-corr-0001');
  assert.equal(req.requestContext.correlationId, 'client-corr-0001');
  assert.equal(res.locals.correlationId, 'client-corr-0001');
  assert.equal(responseHeaders['x-correlation-id'], 'client-corr-0001');
});

test('requestContext generates UUID for invalid incoming x-correlation-id', () => {
  const req = {
    headers: {
      'x-correlation-id': 'invalid id with spaces',
    },
  };
  const responseHeaders = {};
  const res = {
    locals: {},
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value;
    },
  };

  requestContext(req, res, () => {});

  assert.match(req.correlationId, /^[0-9a-f-]{36}$/i);
  assert.equal(req.requestContext.correlationId, req.correlationId);
  assert.equal(res.locals.correlationId, req.correlationId);
  assert.equal(responseHeaders['x-correlation-id'], req.correlationId);
  assert.equal(normalizeCorrelationId('invalid id with spaces'), null);
});

test('openapi spec exists and documents critical routes', () => {
  const specPath = path.resolve(__dirname, '../../docs/OPENAPI.yaml');
  const specContent = fs.readFileSync(specPath, 'utf8');

  assert.match(specContent, /^openapi:\s*3\.0\.3/m);
  assert.match(specContent, /^\s*\/auth\/me:\s*$/m);
  assert.match(specContent, /^\s*\/api\/v1\/agents:\s*$/m);
  assert.match(specContent, /^\s*\/api\/v1\/ai-game\/command:\s*$/m);
  assert.match(specContent, /^\s*\/api\/v1\/system\/ops-dashboard:\s*$/m);
});

test('frontend exposes dedicated HTTP error pages for key statuses', () => {
  const errorPagesDir = path.resolve(__dirname, '../../frontend/public/errors');
  const requiredPages = ['400', '401', '403', '404', '429', '500', '503'];

  requiredPages.forEach((statusCode) => {
    const filePath = path.join(errorPagesDir, `${statusCode}.html`);
    assert.equal(fs.existsSync(filePath), true, `Missing error page: ${statusCode}.html`);

    const html = fs.readFileSync(filePath, 'utf8');
    assert.match(html, new RegExp(`<title>Erro\\s+${statusCode}\\s+-\\s+GardenQuest<\\/title>`));
    assert.match(html, new RegExp(`<p class=\"code\">${statusCode}<\\/p>`));
  });
});

test('public service classes include task-18 jsdoc headers', () => {
  const targets = [
    {
      filePath: path.resolve(__dirname, '../services/agents/AgentDecisionService.js'),
      marker: 'Coordinates decision execution for both official NPC and player-owned agents.',
    },
    {
      filePath: path.resolve(__dirname, '../services/agents/AgentGovernanceService.js'),
      marker: 'Enforces runtime governance constraints (rate limits, budget and circuit breakers) for agents.',
    },
    {
      filePath: path.resolve(__dirname, '../services/world/WorldEventStreamService.js'),
      marker: 'Manages SSE subscriptions for realtime world updates and event batches.',
    },
    {
      filePath: path.resolve(__dirname, '../services/world/WorldRuntimeWorker.js'),
      marker: 'Background worker responsible for processing world command queue and flushing snapshots.',
    },
  ];

  for (const target of targets) {
    const content = fs.readFileSync(target.filePath, 'utf8');
    assert.match(content, /\/\*\*/);
    assert.ok(content.includes(target.marker));
  }
});

test('world event stream service rejects new subscription when total capacity is reached', async () => {
  const service = new WorldEventStreamService({
    realmId: 'realm-01',
    maxSubscribers: 1,
    maxPublicSubscribers: 1,
    maxPlayerSubscribers: 1,
    worldRuntimeRepository: {
      async getLatestWorldRuntimeSnapshot() {
        return null;
      },
      async listWorldRuntimeEvents() {
        return [];
      },
    },
    worldGateway: {
      hydrateSnapshotState() {
        return {};
      },
      async touchPlayerSession() {},
    },
    logger: { error() {}, warn() {}, info() {} },
  });

  service.subscribers.set('existing-1', { id: 'existing-1', kind: 'public' });

  const req = new EventEmitter();
  req.headers = {};
  const res = {};

  await assert.rejects(
    service.subscribePublic(req, res),
    (error) => error?.code === 'sse_capacity_exceeded'
      && error?.statusCode === 429
      && error?.details?.scope === 'total'
  );
});

test('ai-game public stream route maps SSE capacity errors to HTTP 429', async () => {
  const app = express();
  app.use('/api/v1/ai-game', createAiGameRoutes({
    worldEventStreamService: {
      async subscribePublic() {
        const error = new Error('Realtime stream capacity reached.');
        error.code = 'sse_capacity_exceeded';
        error.statusCode = 429;
        error.details = { scope: 'total', maxSubscribers: 1, totalSubscribers: 1 };
        throw error;
      },
      async subscribePlayer() {},
    },
  }));

  const response = await supertest(app)
    .get('/api/v1/ai-game/public-stream')
    .expect(429);

  assert.equal(response.body.code, 'sse_capacity_exceeded');
  assert.equal(response.body.details.scope, 'total');
});

test('world event stream service stop is awaitable and cleans notification bus', async () => {
  let stopCalls = 0;
  let unsubscribeCalls = 0;
  const service = new WorldEventStreamService({
    realmId: 'realm-01',
    worldRuntimeRepository: {
      async getLatestWorldRuntimeSnapshot() {
        return null;
      },
      async listWorldRuntimeEvents() {
        return [];
      },
    },
    worldGateway: {
      hydrateSnapshotState() {
        return {};
      },
      async touchPlayerSession() {},
    },
    notificationBus: {
      subscribe() {
        return () => {
          unsubscribeCalls += 1;
        };
      },
      async start() {},
      async stop() {
        stopCalls += 1;
      },
      getStats() {
        return {};
      },
    },
    pollMs: 1000,
    heartbeatMs: 1000,
    fallbackPollMs: 1000,
    logger: { error() {}, warn() {}, info() {} },
  });

  service.start();
  await service.stop();

  assert.equal(unsubscribeCalls, 1);
  assert.equal(stopCalls, 1);
  assert.equal(service.pollHandle, null);
  assert.equal(service.heartbeatHandle, null);
});

test('world runtime worker start is idempotent across repeated calls', async () => {
  let engineStartCalls = 0;
  const worker = new WorldRuntimeWorker({
    aiGameEngine: {
      start() {
        engineStartCalls += 1;
      },
      async stop() {},
      async exportRuntimeSnapshot() {
        return {
          tick: 1,
          publicState: {},
          actorSnapshots: [],
        };
      },
      getRuntimeStatus() {
        return {};
      },
    },
    worldRuntimeRepository: {
      async claimPendingWorldCommands() {
        return [];
      },
      async getLatestWorldRuntimeSnapshot() {
        return null;
      },
      async upsertWorldRuntimeSnapshot() {},
    },
    realmId: 'realm-01',
    commandPollMs: 10_000,
    snapshotFlushMs: 10_000,
    logger: { error() {}, warn() {}, info() {} },
  });

  await worker.start();
  await worker.start();
  await worker.stop();

  assert.equal(engineStartCalls, 1);
});

test('world runtime gateway health reports ok when db and queue are healthy', async () => {
  const gateway = new WorldRuntimeGateway({
    realmId: 'realm-01',
    snapshotTtlMs: 60_000,
    worldRuntimeRepository: {
      async getLatestWorldRuntimeSnapshot() {
        return {
          snapshotVersion: 42,
          updatedAt: new Date().toISOString(),
          snapshotJson: {},
        };
      },
      async getLatestWorldRuntimeEventSeq() {
        return 120;
      },
      async getWorldCommandQueueOverview() {
        return {
          pendingCount: 0,
          processingCount: 0,
          errorCount: 0,
          deadLetterCount: 0,
          doneCount: 10,
          maxPriority: 100,
          maxAttemptsSeen: 1,
        };
      },
    },
    logger: { error() {}, warn() {}, info() {} },
  });

  const health = await gateway.getRuntimeHealth();
  assert.equal(health.status, 'ok');
  assert.equal(health.database.ok, true);
  assert.equal(health.snapshot.stale, false);
  assert.equal(health.queue.status, 'ok');
  assert.equal(health.latestEventSeq, 120);
});

test('world runtime gateway health reports degraded when db query fails', async () => {
  const gateway = new WorldRuntimeGateway({
    realmId: 'realm-01',
    worldRuntimeRepository: {
      async getLatestWorldRuntimeSnapshot() {
        throw new Error('db_unavailable');
      },
      async getLatestWorldRuntimeEventSeq() {
        return 0;
      },
      async getWorldCommandQueueOverview() {
        return null;
      },
    },
    logger: { error() {}, warn() {}, info() {} },
  });

  const health = await gateway.getRuntimeHealth();
  assert.equal(health.status, 'degraded');
  assert.equal(health.database.ok, false);
  assert.equal(health.queue.status, 'down');
});
