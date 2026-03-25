const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const config = require('../config');
const { AgentWorldScheduler } = require('../services/agents/AgentWorldScheduler');
const { RealmLeaseService } = require('../services/realm/RealmLeaseService');
const { SecretVault } = require('../services/crypto/SecretVault');
const { AgentDecisionService } = require('../services/agents/AgentDecisionService');
const { AgentGovernanceService } = require('../services/agents/AgentGovernanceService');
const { AgentModerationService } = require('../services/agents/AgentModerationService');
const { WorldEventStreamService } = require('../services/world/WorldEventStreamService');
const { classifyWorkerCommandError } = require('../services/world/WorldRuntimeWorker');
const { decodeAuthToken } = require('../middleware/authenticate');

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
